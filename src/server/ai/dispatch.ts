import {
  and,
  asc,
  eq,
  gt,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { getDb, schema } from "@/lib/db";
import {
  createAgentDispatchRunner,
  type AgentDispatchStore,
} from "@/server/ai/dispatch-runner";
import { runAgentTurn } from "@/server/ai/pipeline";

const RETRY_MS = 5_000;

type CoalesceEntry = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  pending: boolean;
};

const globalForDispatch = globalThis as unknown as {
  __agentDispatchCoalesce?: Map<string, CoalesceEntry>;
};

function coalesceMap(): Map<string, CoalesceEntry> {
  if (!globalForDispatch.__agentDispatchCoalesce) {
    globalForDispatch.__agentDispatchCoalesce = new Map();
  }
  return globalForDispatch.__agentDispatchCoalesce;
}

function recoverableAt(now: Date) {
  return or(
    and(
      eq(schema.agentDispatch.status, "pending"),
      lte(schema.agentDispatch.availableAt, now)
    ),
    and(
      eq(schema.agentDispatch.status, "failed"),
      lte(schema.agentDispatch.availableAt, now)
    ),
    and(
      eq(schema.agentDispatch.status, "processing"),
      or(
        isNull(schema.agentDispatch.leaseUntil),
        lt(schema.agentDispatch.leaseUntil, now)
      )
    )
  );
}

const dispatchStore: AgentDispatchStore = {
  async claim(conversationId, now, leaseUntil) {
    const db = getDb();
    return db.transaction(async (tx) => {
      const active = await tx
        .select({ id: schema.agentDispatch.id })
        .from(schema.agentDispatch)
        .where(
          and(
            eq(schema.agentDispatch.conversationId, conversationId),
            eq(schema.agentDispatch.status, "processing"),
            gt(schema.agentDispatch.leaseUntil, now)
          )
        )
        .limit(1);
      if (active[0]) return null;

      const candidates = await tx
        .select()
        .from(schema.agentDispatch)
        .where(
          and(
            eq(schema.agentDispatch.conversationId, conversationId),
            recoverableAt(now)
          )
        )
        .orderBy(asc(schema.agentDispatch.createdAt))
        .for("update", { skipLocked: true })
        .limit(1);
      const candidate = candidates[0];
      if (!candidate) return null;

      const claimed = await tx
        .update(schema.agentDispatch)
        .set({
          status: "processing",
          attempts: sql`${schema.agentDispatch.attempts} + 1`,
          leaseUntil,
          lastErrorCode: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.agentDispatch.id, candidate.id),
            recoverableAt(now)
          )
        )
        .returning({
          id: schema.agentDispatch.id,
          conversationId: schema.agentDispatch.conversationId,
        });
      return claimed[0] ?? null;
    });
  },

  async complete(dispatchId, conversationId, coalesceThrough) {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .update(schema.agentDispatch)
        .set({
          status: "completed",
          leaseUntil: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.agentDispatch.id, dispatchId));

      // All still-pending messages visible when the turn started were included
      // in the same conversation history and are coalesced into this turn.
      await tx
        .update(schema.agentDispatch)
        .set({
          status: "completed",
          leaseUntil: null,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.agentDispatch.conversationId, conversationId),
            eq(schema.agentDispatch.status, "pending"),
            lte(schema.agentDispatch.createdAt, coalesceThrough)
          )
        );
    });
  },

  async fail(dispatchId, code, availableAt) {
    const db = getDb();
    await db
      .update(schema.agentDispatch)
      .set({
        status: "failed",
        availableAt,
        leaseUntil: null,
        lastErrorCode: code,
        updatedAt: new Date(),
      })
      .where(eq(schema.agentDispatch.id, dispatchId));
  },
};

const dispatchRunner = createAgentDispatchRunner({
  store: dispatchStore,
  runTurn: runAgentTurn,
  retryMs: RETRY_MS,
});

/** Debounces a conversation while durable rows retain restart recovery. */
export function scheduleAgentDispatch(conversationId: string): void {
  const map = coalesceMap();
  const entry = map.get(conversationId) ?? {
    timer: null,
    running: false,
    pending: false,
  };
  map.set(conversationId, entry);

  if (entry.running) {
    entry.pending = true;
    return;
  }
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void executeConversation(conversationId);
  }, getEnv().AGENT_COALESCE_MS);
}

async function executeConversation(conversationId: string): Promise<void> {
  const map = coalesceMap();
  const entry = map.get(conversationId);
  if (!entry || entry.running) return;
  entry.running = true;
  let delay = 0;

  try {
    const result = await dispatchRunner.execute(conversationId);
    if (result === "completed") entry.pending = true;
    if (result === "retry") {
      entry.pending = true;
      delay = RETRY_MS;
    }
  } catch {
    console.error("[agent-dispatch] execution_failed");
    entry.pending = true;
    delay = RETRY_MS;
  } finally {
    entry.running = false;
    if (entry.pending) {
      entry.pending = false;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        void executeConversation(conversationId);
      }, delay);
    } else {
      map.delete(conversationId);
    }
  }
}

/** Schedules pending, failed-due, and expired work after process restart. */
export async function resumeAgentDispatches(): Promise<void> {
  const db = getDb();
  const now = new Date();
  // Single-replica restart: no previous process can still own these leases.
  await db
    .update(schema.agentDispatch)
    .set({
      status: "failed",
      availableAt: now,
      leaseUntil: null,
      lastErrorCode: "process_restarted",
      updatedAt: now,
    })
    .where(eq(schema.agentDispatch.status, "processing"));

  const rows = await db
    .select({ conversationId: schema.agentDispatch.conversationId })
    .from(schema.agentDispatch)
    .where(recoverableAt(now));

  for (const conversationId of new Set(rows.map((row) => row.conversationId))) {
    scheduleAgentDispatch(conversationId);
  }
}