import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FR-031 / FR-082: una conversación de prueba del Laboratorio JAMÁS alcanza
 * el canal de WhatsApp — sendText lanza antes de tocar el socket Baileys.
 */

const sendChannelText = vi.fn();

vi.mock("@/server/baileys/manager", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/baileys/manager")>();
  return { ...original, sendChannelText };
});

function makeChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = () => Promise.resolve(rows);
  return chain;
}

const selectRows: unknown[][] = [];

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => makeChain(selectRows.shift() ?? []),
  }),
  schema: {
    conversation: { contactId: "contactId", id: "id", organizationId: "organizationId" },
    contact: { id: "id", organizationId: "organizationId" },
    message: {},
  },
}));

describe("sandbox del Laboratorio en el sender", () => {
  beforeEach(() => {
    sendChannelText.mockReset();
    selectRows.length = 0;
  });

  it("conversación is_test → lanza sandbox_violation y NO toca el canal", async () => {
    selectRows.push([
      {
        conversation: {
          id: "cv_test",
          organizationId: "org_1",
          isTest: true,
          lastInboundAt: new Date(),
        },
        contact: { id: "ct_1", phone: "5215511111111" },
      },
    ]);
    const { sendText, SendError } = await import("@/server/inbox/send");

    await expect(
      sendText({
        conversationId: "cv_test",
        organizationId: "org_1",
        text: "hola",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      })
    ).rejects.toMatchObject({ code: "sandbox_violation" });

    expect(sendChannelText).not.toHaveBeenCalled();

    // sanity: el error es del tipo tipado
    try {
      selectRows.push([
        {
          conversation: {
            id: "cv_test",
            organizationId: "org_1",
            isTest: true,
            lastInboundAt: new Date(),
          },
          contact: { id: "ct_1", phone: "5215511111111" },
        },
      ]);
      await sendText({
        conversationId: "cv_test",
        organizationId: "org_1",
        text: "hola",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(SendError);
    }
    expect(sendChannelText).not.toHaveBeenCalled();
  });
});
