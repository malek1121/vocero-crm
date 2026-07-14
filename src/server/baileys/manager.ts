import makeWASocket, { DisconnectReason } from "baileys";
import type { WASocket } from "baileys";
import pino from "pino";
import {
  clearAuthState,
  hasStoredSession,
  listStoredSessionOrgs,
  loadDbAuthState,
} from "@/server/baileys/auth-state";
import {
  beginSessionGeneration,
  createSessionLifecycle,
  isCurrentSession,
  replaceReconnectTimer,
  stopSessionLifecycle,
  type SessionLifecycle,
} from "@/server/baileys/lifecycle";
import {
  ackToStatus,
  extractContent,
  extractHistoryMessage,
  jidToPhone,
  resolveMessagePhone,
  toJid,
} from "@/server/baileys/map";
import {
  newHistoryIndex,
  type HistoryIndex,
} from "@/server/inbox/history";
import { publish } from "@/server/events/bus";

/** Diagnóstico del último sync de historial (spec 004; leíble por endpoint). */
export type SyncStats = {
  chats: number;
  created: number;
  skippedGroup: number;
  skippedLid: number;
  skippedOther: number;
  messages: number;
  messagesIngested: number;
  lidMappings: number;
  events: number;
  updatedAt: string | null;
};

function newSyncStats(): SyncStats {
  return {
    chats: 0,
    created: 0,
    skippedGroup: 0,
    skippedLid: 0,
    skippedOther: 0,
    messages: 0,
    messagesIngested: 0,
    lidMappings: 0,
    events: 0,
    updatedAt: null,
  };
}

/**
 * Singleton del canal Baileys: un socket por organización, en proceso
 * (spec 002 FR-B09; sin soporte multi-réplica). Cacheado en globalThis para
 * sobrevivir el HMR de Next en dev.
 */

export type ChannelStatus = "disconnected" | "connecting" | "qr" | "connected";
export type ChannelStatusError =
  | "connection_failed"
  | "credentials_save_failed"
  | null;

export class ChannelError extends Error {
  code: "not_connected" | "send_failed";
  constructor(code: ChannelError["code"], message: string) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
  }
}

type Session = SessionLifecycle<WASocket> & {
  status: ChannelStatus;
  qr: string | null;
  phone: string | null;
  error: ChannelStatusError;
  /** 0–100 mientras sincroniza historial; null cuando no hay sync en curso. */
  syncProgress: number | null;
  /** Latch: una vez completo el sync, ignora eventos tardíos hasta re-vincular. */
  syncDone: boolean;
  /** Índice LID→teléfono/nombre acumulado del historial. */
  historyIndex: HistoryIndex;
  /** Diagnóstico acumulado del sync actual. */
  syncStats: SyncStats;
};

const g = globalThis as typeof globalThis & {
  __baileysSessions?: Map<string, Session>;
};
const sessions: Map<string, Session> = (g.__baileysSessions ??= new Map());

const logger = pino({ level: "silent" });
const RECONNECT_DELAY_MS = 3000;

/** Resuelve un LID a teléfono por el store del socket (getPNForLID). */
async function lidToPhone(
  socket: WASocket,
  lid: string
): Promise<string | null> {
  try {
    const pn = await socket.signalRepository?.lidMapping?.getPNForLID(lid);
    if (!pn) return null;
    return jidToPhone(pn) ?? (/^\d{5,15}$/.test(pn) ? pn : null);
  } catch {
    return null;
  }
}

function newSession(): Session {
  return {
    ...createSessionLifecycle<WASocket>(),
    status: "disconnected",
    qr: null,
    phone: null,
    error: null,
    syncProgress: null,
    syncDone: false,
    historyIndex: newHistoryIndex(),
    syncStats: newSyncStats(),
  };
}

function getSession(organizationId: string): Session {
  let session = sessions.get(organizationId);
  if (!session) {
    session = newSession();
    sessions.set(organizationId, session);
    return session;
  }

  // Compatibilidad con sesiones conservadas por HMR antes de estos campos.
  const legacy = session as Partial<Session> & { sock?: WASocket | null };
  if (legacy.socket === undefined) legacy.socket = legacy.sock ?? null;
  legacy.generation ??= 0;
  legacy.stopped ??= false;
  legacy.startPromise ??= null;
  legacy.reconnectTimer ??= null;
  legacy.error ??= null;
  legacy.syncProgress ??= null;
  legacy.syncDone ??= false;
  legacy.historyIndex ??= newHistoryIndex();
  legacy.syncStats ??= newSyncStats();
  delete legacy.sock;
  return session;
}

export function getChannelStatus(organizationId: string): {
  status: ChannelStatus;
  qr: string | null;
  phone: string | null;
  error: ChannelStatusError;
  syncProgress: number | null;
} {
  const session = getSession(organizationId);
  return {
    status: session.status,
    qr: session.qr,
    phone: session.phone,
    error: session.error,
    syncProgress: session.syncProgress,
  };
}

/** Diagnóstico del último sync (leíble por endpoint, sin re-vincular). */
export function getSyncStats(organizationId: string): SyncStats {
  return getSession(organizationId).syncStats;
}

function scheduleReconnect(
  organizationId: string,
  session: Session,
  generation: number
): void {
  if (session.stopped || !isCurrentSession(session, generation)) return;
  session.status = "connecting";

  const timer = setTimeout(() => {
    if (
      session.reconnectTimer !== timer ||
      session.stopped ||
      !isCurrentSession(session, generation)
    ) {
      return;
    }
    session.reconnectTimer = null;
    session.status = "disconnected";
    void startSessionInternal(organizationId, false).catch(() => {
      // startSessionInternal owns state mutation for its captured generation.
      console.error("[baileys] reconnect_failed");
    });
  }, RECONNECT_DELAY_MS);

  replaceReconnectTimer(session, timer);
}

function failCredentialPersistence(
  organizationId: string,
  session: Session,
  generation: number,
  socket: WASocket
): void {
  if (!isCurrentSession(session, generation, socket)) return;
  console.error("[baileys] credentials_save_failed");
  session.generation += 1;
  session.socket = null;
  session.status = "disconnected";
  session.qr = null;
  session.phone = null;
  session.error = "credentials_save_failed";
  void socket.end(new Error("credentials_save_failed")).catch(() => undefined);
  scheduleReconnect(organizationId, session, session.generation);
}

async function openSession(
  organizationId: string,
  session: Session,
  generation: number
): Promise<void> {
  const { state, saveCreds } = await loadDbAuthState(organizationId);
  if (!isCurrentSession(session, generation)) return;

  // syncFullHistory: WhatsApp entrega el historial en tandas con progreso
  // real (spec 004 FR-402) en vez de un único lote mínimo.
  const socket = makeWASocket({ auth: state, logger, syncFullHistory: true });
  session.socket = socket;

  socket.ev.on("creds.update", () => {
    void saveCreds().catch(() =>
      failCredentialPersistence(organizationId, session, generation, socket)
    );
  });

  socket.ev.on("connection.update", (update) => {
    if (!isCurrentSession(session, generation, socket)) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.status = "qr";
      session.qr = qr;
      session.error = null;
    }

    if (connection === "open") {
      session.status = "connected";
      session.qr = null;
      session.phone = jidToPhone(socket.user?.id ?? null);
      session.error = null;
      void import("@/server/inbox/send")
        .then(({ resumeOutboundMessages }) =>
          resumeOutboundMessages(organizationId)
        )
        .catch(() => console.error("[baileys] outbound_recovery_failed"));
    }

    if (connection !== "close") return;

    const statusCode = (
      lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
    )?.output?.statusCode;
    session.socket = null;
    session.qr = null;
    session.phone = null;

    if (statusCode === DisconnectReason.loggedOut) {
      session.generation += 1;
      session.stopped = true;
      session.status = "disconnected";
      session.error = null;
      replaceReconnectTimer(session, null);
      void clearAuthState(organizationId).catch(() =>
        console.error("[baileys] remote_logout_cleanup_failed")
      );
      return;
    }

    scheduleReconnect(organizationId, session, generation);
  });

  socket.ev.on("lid-mapping.update", (mapping) => {
    if (!isCurrentSession(session, generation, socket)) return;
    const phone = jidToPhone(mapping.pn);
    if (phone && mapping.lid) session.historyIndex.phone.set(mapping.lid, phone);
  });

  socket.ev.on("messaging-history.set", async (history) => {
    if (!isCurrentSession(session, generation, socket)) return;
    const { chats, contacts, messages, lidPnMappings, progress, isLatest } =
      history;
    const stats = session.syncStats;
    let inserted = 0;
    try {
      const { ingestHistoryBatch, ingestHistoryChats, extendHistoryIndex } =
        await import("@/server/inbox/history");

      // 1) Acumular el índice LID→teléfono/nombre (autoritativo: lidPnMappings).
      extendHistoryIndex(session.historyIndex, { lidPnMappings, contacts });

      // 1b) WhatsApp no siempre manda lidPnMappings: resolver los LID faltantes
      // por el store del socket (getPNForLID) antes de ingerir chats/mensajes.
      const lidJids = new Set<string>();
      for (const c of chats ?? []) {
        if (c.id?.endsWith("@lid") && !session.historyIndex.phone.has(c.id)) {
          lidJids.add(c.id);
        }
      }
      for (const m of messages ?? []) {
        const jid = m.key?.remoteJid;
        if (jid?.endsWith("@lid") && !session.historyIndex.phone.has(jid)) {
          lidJids.add(jid);
        }
      }
      for (const lid of lidJids) {
        const phone = await lidToPhone(socket, lid);
        if (phone) session.historyIndex.phone.set(lid, phone);
      }
      stats.lidMappings = session.historyIndex.phone.size;

      // 2) La LISTA de conversaciones vive en chats; los cuerpos en messages.
      if (chats?.length) {
        const chatStats = await ingestHistoryChats(
          organizationId,
          chats,
          session.historyIndex
        );
        stats.chats += chats.length;
        stats.created += chatStats.created;
        stats.skippedGroup += chatStats.skippedGroup;
        stats.skippedLid += chatStats.skippedLid;
        stats.skippedOther += chatStats.skippedOther;
        inserted += chatStats.created;
      }

      // 3) Mensajes: resolver LID con el índice acumulado.
      stats.messages += messages?.length ?? 0;
      const items = (messages ?? [])
        .map((m) => extractHistoryMessage(m, session.historyIndex.phone))
        .filter((m): m is NonNullable<typeof m> => m !== null);
      if (items.length > 0) {
        const n = await ingestHistoryBatch(organizationId, items);
        stats.messagesIngested += n;
        inserted += n;
      }
    } catch {
      console.error("[baileys] history_ingest_failed");
    }
    stats.events += 1;
    stats.updatedAt = new Date().toISOString();
    console.info(
      `[history] ev chats=${chats?.length ?? 0} msgs=${messages?.length ?? 0} lidMap=${lidPnMappings?.length ?? 0} | acc created=${stats.created} skGroup=${stats.skippedGroup} skLid=${stats.skippedLid} skOther=${stats.skippedOther} msgsIn=${stats.messagesIngested} idx=${stats.lidMappings}`
    );

    if (!isCurrentSession(session, generation, socket)) return;
    // Terminado si isLatest o progress>=100 → apaga la pantalla de carga (null).
    // Latch: una vez completo, los eventos tardíos no la vuelven a mostrar.
    if (isLatest || (typeof progress === "number" && progress >= 100)) {
      session.syncDone = true;
    }
    session.syncProgress = session.syncDone
      ? null
      : (progress ?? session.syncProgress ?? 0);
    publish(organizationId, {
      type: "channel.sync",
      data: { progress: session.syncProgress, inserted },
    });
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || !isCurrentSession(session, generation, socket)) {
      return;
    }
    const { ingestInboundMessage } = await import("@/server/inbox/ingest");
    for (const msg of messages) {
      try {
        if (!isCurrentSession(session, generation, socket)) return;
        const phone = resolveMessagePhone(msg.key);
        if (!phone || !msg.key.id) continue;
        const content = extractContent(msg.message);
        if (!content) continue;
        await ingestInboundMessage({
          organizationId,
          from: phone,
          profileName: msg.pushName ?? null,
          waMessageId: msg.key.id,
          type: content.type,
          text: content.text,
          timestamp: String(Number(msg.messageTimestamp ?? 0)),
        });
      } catch {
        console.error("[baileys] inbound_ingest_failed");
      }
    }
  });

  socket.ev.on("presence.update", (update) => {
    if (!isCurrentSession(session, generation, socket)) return;
    const phone = jidToPhone(update.id);
    if (!phone) return;
    // En un chat 1:1 la presencia del contacto viene en su propio jid.
    const presence = Object.values(update.presences ?? {})[0];
    const composing =
      presence?.lastKnownPresence === "composing" ||
      presence?.lastKnownPresence === "recording";
    publish(organizationId, { type: "presence", data: { phone, composing } });
  });

  socket.ev.on("messages.update", async (updates) => {
    if (!isCurrentSession(session, generation, socket)) return;
    const { applyStatusUpdate } = await import("@/server/inbox/status");
    for (const update of updates) {
      try {
        if (!isCurrentSession(session, generation, socket)) return;
        const status = ackToStatus(update.update?.status);
        if (!status || !update.key.id) continue;
        await applyStatusUpdate(organizationId, {
          id: update.key.id,
          status,
          timestamp: String(Math.floor(Date.now() / 1000)),
        });
      } catch {
        console.error("[baileys] status_update_failed");
      }
    }
  });
}

function startSessionInternal(
  organizationId: string,
  explicit: boolean
): Promise<void> {
  const session = getSession(organizationId);
  if (session.startPromise) return session.startPromise;
  if (
    session.socket &&
    (session.status === "connecting" ||
      session.status === "qr" ||
      session.status === "connected")
  ) {
    return Promise.resolve();
  }

  const generation = beginSessionGeneration(session, explicit);
  if (generation === null) return Promise.resolve();

  replaceReconnectTimer(session, null);
  session.status = "connecting";
  session.qr = null;
  session.phone = null;
  session.error = null;
  session.syncProgress = null;
  session.syncDone = false;
  session.historyIndex = newHistoryIndex();
  session.syncStats = newSyncStats();

  const tracked = openSession(organizationId, session, generation)
    .catch((error) => {
      if (isCurrentSession(session, generation)) {
        session.socket = null;
        session.status = "disconnected";
        session.qr = null;
        session.phone = null;
        session.error = "connection_failed";
      }
      throw error;
    })
    .finally(() => {
      if (session.startPromise === tracked) session.startPromise = null;
    });
  session.startPromise = tracked;
  return tracked;
}

/** Inicia la conexión; genera QR si no hay sesión guardada. */
export function startSession(organizationId: string): Promise<void> {
  return startSessionInternal(organizationId, true);
}

/** Envía texto libre. Devuelve el id de mensaje de WhatsApp. */
export async function sendChannelText(
  organizationId: string,
  phone: string,
  text: string,
  messageId?: string
): Promise<string> {
  const session = getSession(organizationId);
  if (session.status !== "connected" || !session.socket) {
    throw new ChannelError(
      "not_connected",
      "No hay sesión de WhatsApp conectada; escanea el QR en Configuración"
    );
  }
  try {
    const response = await session.socket.sendMessage(
      toJid(phone),
      { text },
      messageId ? { messageId } : undefined
    );
    const id = response?.key?.id;
    if (!id) {
      throw new ChannelError(
        "send_failed",
        "WhatsApp no devolvió ID de mensaje"
      );
    }
    return id;
  } catch (error) {
    if (error instanceof ChannelError) throw error;
    throw new ChannelError(
      "send_failed",
      "No se pudo enviar el mensaje por WhatsApp"
    );
  }
}

/**
 * Marca mensajes entrantes como leídos en WhatsApp (spec 004 FR-411).
 * Best-effort: si no hay socket conectado, no hace nada.
 */
export async function markChannelRead(
  organizationId: string,
  phone: string,
  waMessageIds: string[]
): Promise<void> {
  const session = getSession(organizationId);
  if (session.status !== "connected" || !session.socket || waMessageIds.length === 0) {
    return;
  }
  const remoteJid = toJid(phone);
  const keys = waMessageIds.map((id) => ({ remoteJid, id, fromMe: false }));
  try {
    await session.socket.readMessages(keys);
  } catch {
    console.error("[baileys] read_receipt_failed");
  }
}

/**
 * Suscribe a la presencia de un contacto para recibir su "escribiendo…"
 * (spec 004 FR-412). Best-effort; sin socket no hace nada.
 */
export async function subscribeContactPresence(
  organizationId: string,
  phone: string
): Promise<void> {
  const session = getSession(organizationId);
  if (session.status !== "connected" || !session.socket) return;
  try {
    await session.socket.presenceSubscribe(toJid(phone));
  } catch {
    console.error("[baileys] presence_subscribe_failed");
  }
}

/**
 * Presencia de escritura hacia un contacto (spec 004 FR-412).
 * Best-effort: `composing` mientras el agente redacta, `paused` al terminar.
 */
export async function sendChannelTyping(
  organizationId: string,
  phone: string,
  state: "composing" | "paused"
): Promise<void> {
  const session = getSession(organizationId);
  if (session.status !== "connected" || !session.socket) return;
  try {
    await session.socket.sendPresenceUpdate(state, toJid(phone));
  } catch {
    console.error("[baileys] presence_failed");
  }
}

/** Logout explícito del operador: cierra socket y borra la sesión guardada. */
export async function logoutSession(organizationId: string): Promise<void> {
  const session = getSession(organizationId);
  const socket = stopSessionLifecycle(session);
  session.status = "disconnected";
  session.qr = null;
  session.phone = null;
  session.error = null;

  try {
    await socket?.logout();
  } catch {
    // El socket puede estar muerto; el borrado de credenciales manda.
  }
  await clearAuthState(organizationId);
}

/** Reanuda al boot las sesiones con credenciales guardadas (FR-B02). */
export async function resumeStoredSessions(): Promise<void> {
  const organizations = await listStoredSessionOrgs();
  for (const organizationId of organizations) {
    if (await hasStoredSession(organizationId)) {
      void startSessionInternal(organizationId, false).catch(() =>
        console.error("[baileys] resume_failed")
      );
    }
  }
}