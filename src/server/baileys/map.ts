import type { proto } from "baileys";

/**
 * Mapeos puros Baileys ⇄ dominio (testeables sin socket). Spec 002 T4.
 */

/** Teléfono E.164 sin "+" → JID de usuario. */
export function toJid(phone: string): string {
  return `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
}

/**
 * JID → teléfono. Solo chats directos (@s.whatsapp.net); grupos, broadcast,
 * newsletter y LID devuelven null y se ignoran.
 * Los LID se resuelven aparte solo cuando Baileys también entrega un JID alternativo.
 */
export function jidToPhone(jid: string | null | undefined): string | null {
  if (!jid?.endsWith("@s.whatsapp.net")) return null;
  const phone = jid.split("@")[0]!.split(":")[0]!;
  return /^\d{5,15}$/.test(phone) ? phone : null;
}
export type MessageAddress = {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
};

/** Resuelve el teléfono de un chat directo, incluido LID con JID alternativo. */
export function resolveMessagePhone(key: MessageAddress): string | null {
  if (key.fromMe) return null;
  const direct = jidToPhone(key.remoteJid);
  if (direct) return direct;
  if (!key.remoteJid?.endsWith("@lid")) return null;
  return jidToPhone(key.remoteJidAlt);
}

export type HistoryMessage = {
  phone: string;
  direction: "in" | "out";
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
};

type HistoryKey = {
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
  fromMe?: boolean | null;
  id?: string | null;
};

/**
 * Mensaje del historial (`messaging-history.set`) → forma de dominio.
 * A diferencia de un entrante en vivo, conserva `fromMe` como dirección `out`.
 * Solo chats directos; grupos/broadcast/estados devuelven null.
 */
/** messageTimestamp puede ser number o Long ({toNumber}); a string de segundos. */
function timestampToString(ts: unknown): string {
  if (typeof ts === "number") return String(ts);
  if (ts && typeof (ts as { toNumber?: unknown }).toNumber === "function") {
    return String((ts as { toNumber: () => number }).toNumber());
  }
  return "0";
}

export function extractHistoryMessage(
  msg: {
    key?: HistoryKey | null;
    message?: proto.IMessage | null;
    messageTimestamp?: unknown;
  },
  // Mapa LID→teléfono (de lidPnMappings/contacts) para chats direccionados por LID.
  phoneByLid?: Map<string, string>
): HistoryMessage | null {
  const key = msg.key;
  if (!key?.id) return null;
  // El otro extremo del chat 1:1 es remoteJid en ambas direcciones.
  let phone =
    jidToPhone(key.remoteJid) ??
    (key.remoteJid?.endsWith("@lid") ? jidToPhone(key.remoteJidAlt) : null);
  if (!phone && phoneByLid && key.remoteJid?.endsWith("@lid")) {
    phone = phoneByLid.get(key.remoteJid) ?? null;
  }
  if (!phone) return null;
  const content = extractContent(msg.message);
  if (!content) return null;
  return {
    phone,
    direction: key.fromMe ? "out" : "in",
    waMessageId: key.id,
    type: content.type,
    text: content.text,
    timestamp: timestampToString(msg.messageTimestamp),
  };
}

/** Ack de Baileys (proto.WebMessageInfo.Status) → estado de dominio. */
export function ackToStatus(
  ack: number | null | undefined
): "sent" | "delivered" | "read" | null {
  switch (ack) {
    case 2: // SERVER_ACK
      return "sent";
    case 3: // DELIVERY_ACK
      return "delivered";
    case 4: // READ
      return "read";
    default:
      return null;
  }
}

const CONTENT_TYPES: [keyof proto.IMessage, string][] = [
  ["imageMessage", "image"],
  ["audioMessage", "audio"],
  ["videoMessage", "video"],
  ["documentMessage", "document"],
  ["stickerMessage", "sticker"],
  ["locationMessage", "location"],
  ["contactMessage", "contacts"],
  ["contactsArrayMessage", "contacts"],
];

/**
 * Contenido de un mensaje entrante → { type, text } del dominio.
 * Tipos no soportados → null (se ignoran sin error).
 */
export function extractContent(
  message: proto.IMessage | null | undefined
): { type: string; text: string | null } | null {
  if (!message) return null;
  const text =
    message.conversation ?? message.extendedTextMessage?.text ?? null;
  if (text) return { type: "text", text };
  for (const [key, type] of CONTENT_TYPES) {
    if (message[key]) {
      const caption = (message[key] as { caption?: string | null })?.caption;
      return { type, text: caption ?? null };
    }
  }
  return null;
}
