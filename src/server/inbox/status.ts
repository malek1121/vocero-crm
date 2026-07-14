import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { publish } from "@/server/events/bus";
import {
  getStatusPersistence,
  type MessageStatus,
} from "@/server/inbox/status-state";

/** Actualización de estado de un mensaje saliente (acks del canal). */
export type StatusUpdate = {
  id: string;
  status: string;
  timestamp: string;
  errors?: { code: number; title?: string; message?: string }[];
};

/** Orden monotónico de estados: nunca degradar (un delivered tardío no pisa read). */
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};



export function isUpgrade(current: string, next: string): boolean {
  if (next === "failed") return current !== "failed";
  const c = STATUS_RANK[current];
  const n = STATUS_RANK[next];
  if (c === undefined || n === undefined) return false;
  return n > c;
}

export async function applyStatusUpdate(
  organizationId: string,
  status: StatusUpdate
): Promise<void> {
  const next = status.status;
  if (!(next in STATUS_RANK) && next !== "failed") return; // estado desconocido

  const db = getDb();
  const rows = await db
    .select({
      id: schema.message.id,
      conversationId: schema.message.conversationId,
      status: schema.message.status,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.waMessageId, status.id)
      )
    )
    .limit(1);
  const msg = rows[0];
  if (!msg) return;
  if (!isUpgrade(msg.status, next)) return;

  const persistence = getStatusPersistence(next as MessageStatus);

  await db
    .update(schema.message)
    .set(persistence)
    .where(eq(schema.message.id, msg.id));

  publish(organizationId, {
    type: "message.status",
    data: {
      conversationId: msg.conversationId,
      messageId: msg.id,
      status: next,
    },
  });
}
