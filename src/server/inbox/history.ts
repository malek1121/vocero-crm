import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { jidToPhone, type HistoryMessage } from "@/server/baileys/map";
export type { HistoryMessage } from "@/server/baileys/map";
import { publish } from "@/server/events/bus";
import { serializeMessage } from "@/server/inbox/ingest";

export const HISTORY_CHAT_LIMIT = 30;

type BufferedChat = {
  latestTimestamp: number;
  messages: Map<string, HistoryMessage>;
};

export type HistoryBuffer = Map<string, BufferedChat>;

export function newHistoryBuffer(): HistoryBuffer {
  return new Map();
}

function historyTimestamp(item: HistoryMessage): number {
  const value = Number(item.timestamp);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Keeps a bounded, newest-first candidate set until history sync completes.
 * No database rows are created while the candidate set is incomplete.
 */
export function addHistoryMessages(
  buffer: HistoryBuffer,
  items: HistoryMessage[],
  chatLimit = HISTORY_CHAT_LIMIT
): void {
  const byPhone = new Map<string, HistoryMessage[]>();
  for (const item of items) {
    const current = byPhone.get(item.phone) ?? [];
    current.push(item);
    byPhone.set(item.phone, current);
  }

  for (const [phone, phoneItems] of byPhone) {
    const latestTimestamp = Math.max(...phoneItems.map(historyTimestamp));
    let chat = buffer.get(phone);

    if (!chat && buffer.size >= chatLimit) {
      let oldestPhone: string | null = null;
      let oldestTimestamp = Number.POSITIVE_INFINITY;
      for (const [candidatePhone, candidate] of buffer) {
        if (candidate.latestTimestamp < oldestTimestamp) {
          oldestPhone = candidatePhone;
          oldestTimestamp = candidate.latestTimestamp;
        }
      }
      if (latestTimestamp <= oldestTimestamp || !oldestPhone) continue;
      buffer.delete(oldestPhone);
    }

    chat ??= { latestTimestamp, messages: new Map() };
    chat.latestTimestamp = Math.max(chat.latestTimestamp, latestTimestamp);
    for (const item of phoneItems) {
      chat.messages.set(item.waMessageId, item);
    }

    buffer.set(phone, chat);
  }
}

export function readHistoryMessages(buffer: HistoryBuffer): HistoryMessage[] {
  return [...buffer.values()]
    .flatMap((chat) => [...chat.messages.values()])
    .sort((a, b) => historyTimestamp(a) - historyTimestamp(b));
}

/**
 * Ingesta de historial (spec 004 FR-401). A diferencia del entrante en vivo:
 * NO dispara el agente, NO incrementa no-leídos y NO marca `processed`.
 * Idempotente por `wa_message_id`. Un contacto/conversación por teléfono.
 */

function toDate(timestamp: string): Date {
  const value = Number(timestamp);
  if (Number.isFinite(value) && value > 0) return new Date(value * 1000);
  return new Date();
}

function tsToDate(ts: unknown): Date | null {
  const n =
    typeof ts === "number"
      ? ts
      : ts && typeof (ts as { toNumber?: unknown }).toNumber === "function"
        ? (ts as { toNumber: () => number }).toNumber()
        : 0;
  return n > 0 ? new Date(n * 1000) : null;
}

export type HistoryChat = { id?: string | null; name?: string | null; conversationTimestamp?: unknown };
export type HistoryContact = {
  id?: string | null;
  lid?: string | null;
  name?: string | null;
  notify?: string | null;
  phoneNumber?: string | null;
};
export type LidMapping = { pn?: string | null; lid?: string | null };

/** Índice LID→teléfono y LID→nombre, acumulado entre eventos de historial. */
export type HistoryIndex = {
  phone: Map<string, string>;
  name: Map<string, string>;
};

export function newHistoryIndex(): HistoryIndex {
  return { phone: new Map(), name: new Map() };
}

/** Suma mapeos LID→teléfono/nombre de un evento al índice persistente. */
export function extendHistoryIndex(
  index: HistoryIndex,
  input: { lidPnMappings?: LidMapping[]; contacts?: HistoryContact[] }
): void {
  // lidPnMappings: fuente autoritativa {pn, lid} de WhatsApp.
  for (const m of input.lidPnMappings ?? []) {
    const phone = jidToPhone(m.pn);
    if (phone && m.lid) index.phone.set(m.lid, phone);
  }
  for (const c of input.contacts ?? []) {
    const phone = jidToPhone(c.phoneNumber);
    const name = c.name?.trim() || c.notify?.trim();
    for (const key of [c.id, c.lid]) {
      if (!key) continue;
      if (phone) index.phone.set(key, phone);
      if (name) index.name.set(key, name);
    }
  }
}

/** Resuelve el teléfono de un jid (PN directo o LID vía índice). */
function resolveJidPhone(
  jid: string | null | undefined,
  index: HistoryIndex
): string | null {
  const direct = jidToPhone(jid);
  if (direct) return direct;
  if (jid?.endsWith("@lid")) return index.phone.get(jid) ?? null;
  return null;
}

/** Clasifica por qué un chat no resolvió a un teléfono 1:1. */
function skipReason(jid: string | null | undefined): "group" | "lid" | "other" {
  if (jid?.endsWith("@g.us") || jid?.endsWith("@broadcast") || jid?.endsWith("@newsletter")) {
    return "group";
  }
  if (jid?.endsWith("@lid")) return "lid";
  return "other";
}

export type ChatIngestStats = {
  created: number;
  skippedGroup: number;
  skippedLid: number;
  skippedOther: number;
};

/**
 * Materializa la LISTA de conversaciones del historial (spec 004 FR-401):
 * cada `chat` directo → contacto + conversación. WhatsApp direcciona los
 * chats por LID (`<id>@lid`); el teléfono se resuelve por el índice.
 */
export async function ingestHistoryChats(
  organizationId: string,
  chats: HistoryChat[],
  index: HistoryIndex
): Promise<ChatIngestStats> {
  const db = getDb();
  const stats: ChatIngestStats = {
    created: 0,
    skippedGroup: 0,
    skippedLid: 0,
    skippedOther: 0,
  };

  for (const chat of chats) {
    const phone = resolveJidPhone(chat.id, index);
    if (!phone) {
      const reason = skipReason(chat.id);
      if (reason === "group") stats.skippedGroup += 1;
      else if (reason === "lid") stats.skippedLid += 1;
      else stats.skippedOther += 1;
      continue;
    }
    const name = chat.name?.trim() || index.name.get(chat.id ?? "") || phone;

    const insertedContact = await db
      .insert(schema.contact)
      .values({ id: newId("contact"), organizationId, phone, name })
      .onConflictDoNothing()
      .returning({ id: schema.contact.id });
    let contactId = insertedContact[0]?.id;
    if (!contactId) {
      const found = await db
        .select({ id: schema.contact.id })
        .from(schema.contact)
        .where(
          and(
            eq(schema.contact.organizationId, organizationId),
            eq(schema.contact.phone, phone)
          )
        )
        .limit(1);
      contactId = found[0]?.id;
    }
    if (!contactId) continue;

    const insertedConversation = await db
      .insert(schema.conversation)
      .values({
        id: newId("conversation"),
        organizationId,
        contactId,
        lastMessageAt: tsToDate(chat.conversationTimestamp),
      })
      .onConflictDoNothing()
      .returning({ id: schema.conversation.id });
    if (insertedConversation[0]) stats.created += 1;
  }
  return stats;
}

async function getOrCreateContactId(
  organizationId: string,
  phone: string,
  name: string | null
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      phone,
      name: name?.trim() || phone,
    })
    .onConflictDoNothing()
    .returning({ id: schema.contact.id });
  if (inserted[0]) return inserted[0].id;

  const rows = await db
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.organizationId, organizationId),
        eq(schema.contact.phone, phone)
      )
    )
    .limit(1);
  if (!rows[0]) throw new Error("history_contact_missing");
  return rows[0].id;
}

async function getOrCreateConversationId(
  organizationId: string,
  contactId: string
): Promise<string> {
  const db = getDb();
  const inserted = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId })
    .onConflictDoNothing()
    .returning({ id: schema.conversation.id });
  if (inserted[0]) return inserted[0].id;

  const rows = await db
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.contactId, contactId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  if (!rows[0]) throw new Error("history_conversation_missing");
  return rows[0].id;
}

/** Ingiere un lote de mensajes históricos. Devuelve cuántos se insertaron. */
export async function ingestHistoryBatch(
  organizationId: string,
  items: HistoryMessage[]
): Promise<number> {
  const db = getDb();
  // Cache por teléfono dentro del lote para no reconsultar el mismo contacto.
  const conversationByPhone = new Map<string, string>();
  let inserted = 0;

  for (const item of items) {
    let conversationId = conversationByPhone.get(item.phone);
    if (!conversationId) {
      const contactId = await getOrCreateContactId(
        organizationId,
        item.phone,
        null
      );
      conversationId = await getOrCreateConversationId(
        organizationId,
        contactId
      );
      conversationByPhone.set(item.phone, conversationId);
    }

    const waTimestamp = toDate(item.timestamp);
    const rows = await db
      .insert(schema.message)
      .values({
        id: newId("message"),
        organizationId,
        conversationId,
        waMessageId: item.waMessageId,
        direction: item.direction,
        type: item.type,
        text: item.text,
        status: item.direction === "in" ? "delivered" : "sent",
        deliveryState: item.direction === "out" ? "sent" : null,
        waTimestamp,
        // Histórico: ya procesado, jamás lo toma el agente ni la recuperación.
        processedAt: item.direction === "in" ? waTimestamp : null,
      })
      .onConflictDoNothing()
      .returning({ id: schema.message.id });

    if (rows[0]) {
      inserted += 1;
      await db
        .update(schema.conversation)
        .set({
          lastMessageAt: sql`greatest(${schema.conversation.lastMessageAt}, ${waTimestamp})`,
        })
        .where(
          and(
            eq(schema.conversation.id, conversationId),
            eq(schema.conversation.organizationId, organizationId)
          )
        );
    }
  }

  return inserted;
}


/**
 * Mirrors an outgoing message observed from the phone or another companion.
 * It is durable and idempotent, but never changes unread state or wakes AI.
 */
export async function ingestObservedOutgoingMessage(
  organizationId: string,
  item: HistoryMessage
): Promise<boolean> {
  if (item.direction !== "out") return false;
  const inserted = await ingestHistoryBatch(organizationId, [item]);
  if (inserted === 0) return false;

  const db = getDb();
  const rows = await db
    .select()
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.waMessageId, item.waMessageId)
      )
    )
    .limit(1);
  const message = rows[0];
  if (!message) return false;

  publish(organizationId, {
    type: "message.new",
    data: {
      conversationId: message.conversationId,
      message: serializeMessage(message),
    },
  });
  publish(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: message.conversationId } },
  });
  return true;
}
