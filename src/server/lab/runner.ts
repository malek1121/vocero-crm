import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { throwIfAborted } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { runAgentTurn } from "@/server/ai/pipeline";
import { renderKb } from "@/server/ai/prompts";
import { judgeCase } from "@/server/lab/judge";
import { PERSONAS, type Persona } from "@/server/lab/personas";
import { createRunDeadline } from "@/server/lab/run-control";
import { computeScore } from "@/server/lab/score";

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

type RunFailureCode = "run_timeout" | "run_failed" | "process_restarted";

export class RunConflictError extends Error {}

export async function startRun(organizationId: string): Promise<string> {
  const db = getDb();
  const runId = newId("testRun");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.agentTestRun).values({
        id: runId,
        organizationId,
        status: "running",
      });
      await tx.insert(schema.agentTestCase).values(
        PERSONAS.map((persona) => ({
          id: newId("testCase"),
          organizationId,
          runId,
          persona: persona.key,
          status: "pending" as const,
        }))
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new RunConflictError("Ya hay una corrida en curso");
    }
    throw error;
  }

  void executeRun(runId, organizationId).catch(() =>
    console.error("[lab] run_executor_failed")
  );
  return runId;
}

async function executeRun(
  runId: string,
  organizationId: string
): Promise<void> {
  const deadline = createRunDeadline(RUN_TIMEOUT_MS);
  try {
    await runAllCases(runId, organizationId, deadline.signal);
    throwIfAborted(deadline.signal);
  } catch {
    await failRun(
      runId,
      organizationId,
      deadline.timedOut() ? "run_timeout" : "run_failed"
    );
  } finally {
    deadline.clear();
  }
}

async function runAllCases(
  runId: string,
  organizationId: string,
  signal: AbortSignal
): Promise<void> {
  throwIfAborted(signal);
  const db = getDb();
  const cases = await db
    .select()
    .from(schema.agentTestCase)
    .where(
      and(
        eq(schema.agentTestCase.runId, runId),
        eq(schema.agentTestCase.organizationId, organizationId)
      )
    )
    .orderBy(asc(schema.agentTestCase.createdAt));

  const kbEntries = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));
  const kbText = renderKb(kbEntries);

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  const behaviorText = profile
    ? [
        `Nombre: ${profile.name}`,
        profile.tone ? `Tono: ${profile.tone}` : null,
        profile.instructions ? `Instrucciones: ${profile.instructions}` : null,
        profile.escalationRules ? `Escalado: ${profile.escalationRules}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  let done = 0;
  const total = cases.length;
  publishProgress(organizationId, runId, "running", done, total);

  for (const testCase of cases) {
    throwIfAborted(signal);
    const persona = PERSONAS.find((candidate) => candidate.key === testCase.persona);
    if (!persona) throw new Error("lab_persona_missing");

    await db
      .update(schema.agentTestCase)
      .set({ status: "running" })
      .where(
        and(
          eq(schema.agentTestCase.id, testCase.id),
          eq(schema.agentTestCase.organizationId, organizationId),
          eq(schema.agentTestCase.runId, runId)
        )
      );

    const { transcript, conversationId } = await runConversation(
      organizationId,
      persona,
      signal
    );
    throwIfAborted(signal);

    const outcome = await judgeCase(
      {
        personaKey: persona.key,
        transcript,
        kbText,
        behaviorText,
      },
      signal
    );
    throwIfAborted(signal);

    await db
      .update(schema.agentTestCase)
      .set({
        conversationId,
        transcript,
        status: outcome.status,
        veredicto: outcome.status === "done" ? outcome.verdict.veredicto : null,
        hallazgos: outcome.status === "done" ? outcome.verdict.hallazgos : null,
      })
      .where(
        and(
          eq(schema.agentTestCase.id, testCase.id),
          eq(schema.agentTestCase.organizationId, organizationId),
          eq(schema.agentTestCase.runId, runId)
        )
      );

    done += 1;
    publishProgress(organizationId, runId, "running", done, total);
  }

  throwIfAborted(signal);
  const finalCases = await db
    .select({
      status: schema.agentTestCase.status,
      veredicto: schema.agentTestCase.veredicto,
    })
    .from(schema.agentTestCase)
    .where(
      and(
        eq(schema.agentTestCase.runId, runId),
        eq(schema.agentTestCase.organizationId, organizationId)
      )
    );
  const score = computeScore(finalCases);

  const completed = await db
    .update(schema.agentTestRun)
    .set({ status: "done", score, error: null, finishedAt: new Date() })
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.organizationId, organizationId),
        eq(schema.agentTestRun.status, "running")
      )
    )
    .returning({ id: schema.agentTestRun.id });
  if (!completed[0]) return;
  publishProgress(organizationId, runId, "done", done, total, score);
}

async function runConversation(
  organizationId: string,
  persona: Persona,
  signal: AbortSignal
): Promise<{
  transcript: { role: "cliente" | "agente"; text: string }[];
  conversationId: string;
}> {
  throwIfAborted(signal);
  const db = getDb();
  const contactId = await upsertTestContact(organizationId, persona);
  const conversationId = newId("conversation");
  await db.insert(schema.conversation).values({
    id: conversationId,
    organizationId,
    contactId,
    isTest: true,
    aiEnabled: true,
  });

  for (const line of persona.script) {
    throwIfAborted(signal);
    const now = new Date();
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId,
      conversationId,
      direction: "in",
      type: "text",
      text: line,
      status: "delivered",
      waTimestamp: now,
    });
    await db
      .update(schema.conversation)
      .set({ lastInboundAt: now, lastMessageAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.organizationId, organizationId)
        )
      );

    await runAgentTurn(conversationId, { signal });
    throwIfAborted(signal);

    const conversationRows = await db
      .select({ handoffAt: schema.conversation.handoffAt })
      .from(schema.conversation)
      .where(
        and(
          eq(schema.conversation.id, conversationId),
          eq(schema.conversation.organizationId, organizationId)
        )
      )
      .limit(1);
    if (conversationRows[0]?.handoffAt) break;
  }

  throwIfAborted(signal);
  const messages = await db
    .select()
    .from(schema.message)
    .where(
      and(
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.organizationId, organizationId)
      )
    )
    .orderBy(asc(schema.message.createdAt));

  return {
    conversationId,
    transcript: messages
      .filter((message) => message.text)
      .map((message) => ({
        role: message.direction === "in" ? ("cliente" as const) : ("agente" as const),
        text: message.text!,
      })),
  };
}

async function upsertTestContact(
  organizationId: string,
  persona: Persona
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone: persona.phone,
      name: persona.contactName,
      archivedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0].id;

  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, persona.phone)
      )
    )
    .limit(1);
  const contact = rows[0];
  if (!contact) throw new Error("lab_contact_missing");
  return contact.id;
}

async function failRun(
  runId: string,
  organizationId: string,
  error: RunFailureCode
): Promise<void> {
  const db = getDb();
  const failed = await db
    .update(schema.agentTestRun)
    .set({ status: "failed", score: null, error, finishedAt: new Date() })
    .where(
      and(
        eq(schema.agentTestRun.id, runId),
        eq(schema.agentTestRun.organizationId, organizationId),
        eq(schema.agentTestRun.status, "running")
      )
    )
    .returning({ id: schema.agentTestRun.id });
  if (!failed[0]) return;
  publishProgress(organizationId, runId, "failed", 0, PERSONAS.length);
}

function publishProgress(
  organizationId: string,
  runId: string,
  status: string,
  done: number,
  total: number,
  score?: number | null
): void {
  try {
    publish(organizationId, {
      type: "lab.run",
      data: { runId, status, progress: { done, total }, score },
    });
  } catch {
    console.error("[lab] progress_publish_failed");
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}