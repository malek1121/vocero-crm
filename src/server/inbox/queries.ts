import {
  and,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { encodeCursor, type InboxCursor } from "@/server/inbox/cursor";

export const INBOX_PAGE_SIZE = 100;

export type ConversationDto = {
  id: string;
  contact: { id: string; name: string; phone: string };
  stageName: string | null;
  aiEnabled: boolean;
  handoffAt: string | null;
  handoffReason: string | null;
  lastInboundAt: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  archived: boolean;
  preview: string | null;
};

export async function listConversations(
  organizationId: string,
  options: {
    since?: Date;
    archived?: boolean;
    before?: InboxCursor;
    limit?: number;
  } = {}
): Promise<{ conversations: ConversationDto[]; nextCursor: string | null }> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), 200);
  const previewSql = sql<string | null>`(
    select coalesce(m.text, m.type)
    from message m
    where m.conversation_id = ${schema.conversation.id}
    order by m.created_at desc
    limit 1
  )`;
  const stageSql = sql<string | null>`(
    select s.name from lead l
    join pipeline_stage s on s.id = l.stage_id
    where l.contact_id = ${schema.contact.id}
    limit 1
  )`;
  const activitySql = sql<Date>`coalesce(${schema.conversation.lastMessageAt}, ${schema.conversation.createdAt})`;
  const before = options.before;

  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
      preview: previewSql,
      stageName: stageSql,
      activityAt: activitySql,
    })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.isTest, false),
        options.archived
          ? isNotNull(schema.contact.archivedAt)
          : isNull(schema.contact.archivedAt),
        options.since ? gt(schema.conversation.updatedAt, options.since) : undefined,
        before
          ? or(
              lt(activitySql, before.createdAt),
              and(
                eq(activitySql, before.createdAt),
                lt(schema.conversation.id, before.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(activitySql), desc(schema.conversation.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    conversations: page.map((row) =>
      serializeConversation(
        row.conversation,
        row.contact,
        row.preview,
        row.stageName
      )
    ),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({
            createdAt: new Date(last.activityAt),
            id: last.conversation.id,
          })
        : null,
  };
}

export async function getConversation(
  organizationId: string,
  conversationId: string
) {
  const db = getDb();
  const rows = await db
    .select({ conversation: schema.conversation, contact: schema.contact })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.conversation.contactId, schema.contact.id))
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        eq(schema.conversation.id, conversationId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listMessages(
  organizationId: string,
  conversationId: string,
  options: { since?: Date; before?: InboxCursor; limit?: number } = {}
) {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? INBOX_PAGE_SIZE, 1), 200);
  const before = options.before;
  const rows = await db
    .select()
    .from(schema.message)
    .where(
      scoped(
        schema.message.organizationId,
        organizationId,
        eq(schema.message.conversationId, conversationId),
        options.since ? gt(schema.message.createdAt, options.since) : undefined,
        before
          ? or(
              lt(schema.message.createdAt, before.createdAt),
              and(
                eq(schema.message.createdAt, before.createdAt),
                lt(schema.message.id, before.id)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(schema.message.createdAt), desc(schema.message.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const oldest = page.at(-1);
  return {
    messages: page.reverse(),
    nextCursor:
      rows.length > limit && oldest
        ? encodeCursor({ createdAt: oldest.createdAt, id: oldest.id })
        : null,
  };
}
export function serializeConversation(
  c: typeof schema.conversation.$inferSelect,
  contact: typeof schema.contact.$inferSelect,
  preview: string | null = null,
  stageName: string | null = null
): ConversationDto {
  return {
    id: c.id,
    contact: { id: contact.id, name: contact.name, phone: contact.phone },
    stageName,
    aiEnabled: c.aiEnabled,
    handoffAt: c.handoffAt?.toISOString() ?? null,
    handoffReason: c.handoffReason,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unreadCount: c.unreadCount,
    archived: contact.archivedAt !== null,
    preview,
  };
}

export async function updateConversation(
  organizationId: string,
  conversationId: string,
  patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
    markRead?: boolean;
    archived?: boolean;
  }
) {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.aiEnabled !== undefined) set.aiEnabled = patch.aiEnabled;
  if (patch.reactivate) {
    set.handoffAt = null;
    set.handoffReason = null;
    set.aiEnabled = patch.aiEnabled ?? true;
  }
  if (patch.markRead) set.unreadCount = 0;

  const updated = await db
    .update(schema.conversation)
    .set(set)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId)
      )
    )
    .returning();
  const conversation = updated[0] ?? null;

  // Archivar/desarchivar = estado del contacto (spec 004 FR-421).
  if (patch.archived !== undefined && conversation) {
    await db
      .update(schema.contact)
      .set({ archivedAt: patch.archived ? new Date() : null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contact.id, conversation.contactId),
          eq(schema.contact.organizationId, organizationId)
        )
      );
  }

  // Tildes azules en WhatsApp al abrir la conversación (spec 004 FR-411).
  if (patch.markRead && conversation) {
    void sendReadReceipts(organizationId, conversationId).catch(() => {});
  }
  return conversation;
}

async function sendReadReceipts(
  organizationId: string,
  conversationId: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({
      waMessageId: schema.message.waMessageId,
      phone: schema.contact.phone,
    })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        eq(schema.message.direction, "in")
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  const phone = rows[0]?.phone;
  if (!phone) return;
  const ids = rows
    .map((r) => r.waMessageId)
    .filter((id): id is string => id !== null);
  const manager = await import("@/server/baileys/manager");
  // Abrir la conversación: marcar leído + suscribirse a su "escribiendo…".
  await manager.subscribeContactPresence(organizationId, phone);
  if (ids.length > 0) await manager.markChannelRead(organizationId, phone, ids);
}
