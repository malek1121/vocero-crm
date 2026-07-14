import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-031/FR-082: el turno del agente sobre una conversación is_test persiste
 * la respuesta en BD y JAMÁS toca el canal (spy sobre el manager de Baileys).
 */

const sendChannelText = vi.fn();

vi.mock("@/server/baileys/manager", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/baileys/manager")>();
  return { ...original, sendChannelText };
});

vi.mock("@/lib/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...original,
    chatJson: vi.fn().mockResolvedValue({
      ok: true,
      data: { action: "reply", text: "respuesta simulada" },
      raw: "{}",
    }),
  };
});

// BD simulada: cola de resultados de select + capturas de insert/update.
const selectQueue: unknown[][] = [];
const inserts: { table: unknown; values: unknown }[] = [];

function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) {
    chain[m] = () => chain;
  }
  (chain as { then: unknown }).then = (
    resolve: (v: unknown) => void
  ) => Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([values]),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve([values]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{}]),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve([{}]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy(
    {},
    {
      get: (_t, tableName) =>
        new Proxy(
          {},
          { get: (_t2, col) => `${String(tableName)}.${String(col)}` }
        ),
    }
  ),
}));

describe("sandbox del Laboratorio en el pipeline del agente", () => {
  beforeEach(() => {
    sendChannelText.mockReset();
    selectQueue.length = 0;
    inserts.length = 0;
    vi.stubEnv("AI_API_TOKEN", "token-test");
    vi.stubEnv("AI_MODEL", "model-test");
  });

  it("turno sobre conversación is_test → persiste la respuesta y NO toca el canal", async () => {
    const testConversation = {
      id: "cv_lab",
      organizationId: "org_1",
      contactId: "ct_lab",
      isTest: true,
      aiEnabled: true,
      handoffAt: null,
      handoffReason: null,
      lastInboundAt: new Date(),
    };
    selectQueue.push(
      [testConversation], // conversación
      [{ id: "agp_1", organizationId: "org_1", enabled: false, name: "Asistente", tone: null, instructions: null, escalationRules: null, greeting: null }], // perfil (apagado: el Lab evalúa igual)
      [
        {
          id: "msg_1",
          direction: "in",
          text: "¿tienen taladros?",
          createdAt: new Date(),
        },
      ], // historial
      [], // kb
      [] // etapas
    );

    const { runAgentTurn } = await import("@/server/ai/pipeline");
    await runAgentTurn("cv_lab");

    expect(sendChannelText).not.toHaveBeenCalled();
    // la respuesta quedó persistida como mensaje saliente ai_generated
    const messageInsert = inserts.find(
      (i) =>
        typeof i.values === "object" &&
        i.values !== null &&
        (i.values as { direction?: string }).direction === "out"
    );
    expect(messageInsert).toBeDefined();
    expect((messageInsert!.values as { aiGenerated: boolean }).aiGenerated).toBe(
      true
    );
    expect((messageInsert!.values as { text: string }).text).toBe(
      "respuesta simulada"
    );
  });
});
