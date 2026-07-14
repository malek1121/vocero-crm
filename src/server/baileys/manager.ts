import makeWASocket, { DisconnectReason, proto } from "baileys";
import type { WASocket } from "baileys";
import pino from "pino";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
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
  extractHistoryMessage,
  jidToPhone,
  toJid,
} from "@/server/baileys/map";
import {
  newHistoryBuffer,
  newHistoryIndex,
  type HistoryBuffer,
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

export type ChannelStatus =
  | "unlinked"
  | "connecting"
  | "qr"
  | "connected"
  | "reconnecting";
export type ChannelStatusError =
  | "connection_failed"
  | "credentials_save_failed"
  | "phone_mismatch"
  | null;

export class ChannelError extends Error {
  code: "not_connected" | "send_failed" | "history_unavailable";
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
  storedPhone: string | null;
  initialImportComplete: boolean;
  error: ChannelStatusError;
  /** 0–100 mientras sincroniza historial; null cuando no hay sync en curso. */
  syncProgress: number | null;
  /** Latch: una vez completo el sync, ignora eventos tardíos hasta re-vincular. */
  syncDone: boolean;
  /** Índice LID→teléfono/nombre acumulado del historial. */
  historyIndex: HistoryIndex;
  /** Candidate messages for the bounded initial/relink history import. */
  historyBuffer: HistoryBuffer;
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

async function loadOrganizationWhatsAppState(
  organizationId: string,
  session: Session
): Promise<void> {
  const rows = await getDb()
    .select({
      whatsappPhone: schema.organization.whatsappPhone,
      whatsappInitialImportedAt: schema.organization.whatsappInitialImportedAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  session.storedPhone = rows[0]?.whatsappPhone ?? null;
  session.initialImportComplete = Boolean(
    rows[0]?.whatsappInitialImportedAt
  );
}

async function completeConnectionOpen(
  organizationId: string,
  session: Session,
  generation: number,
  socket: WASocket
): Promise<void> {
  if (!isCurrentSession(session, generation, socket)) return;
  const actualPhone = jidToPhone(socket.user?.id ?? null);

  if (
    session.storedPhone &&
    actualPhone &&
    session.storedPhone !== actualPhone
  ) {
    session.generation += 1;
    session.stopped = true;
    session.socket = null;
    session.status = "unlinked";
    session.qr = null;
    session.phone = null;
    session.error = "phone_mismatch";
    replaceReconnectTimer(session, null);
    try {
      await socket.logout();
    } catch {
      // The durable credential cleanup below is authoritative.
    }
    await clearAuthState(organizationId);
    return;
  }

  if (!session.storedPhone && actualPhone) {
    await getDb()
      .update(schema.organization)
      .set({ whatsappPhone: actualPhone })
      .where(eq(schema.organization.id, organizationId));
    session.storedPhone = actualPhone;
  }

  if (!isCurrentSession(session, generation, socket)) return;
  session.status = "connected";
  session.qr = null;
  session.phone = actualPhone;
  session.error = null;
  if (!session.initialImportComplete) session.syncProgress = 0;

  void import("@/server/inbox/send")
    .then(({ resumeOutboundMessages }) =>
      resumeOutboundMessages(organizationId)
    )
    .catch(() => console.error("[baileys] outbound_recovery_failed"));
}

async function finalizeBufferedHistory(
  organizationId: string,
  session: Session,
  generation: number,
  socket: WASocket
): Promise<number> {
  if (
    session.syncDone ||
    !isCurrentSession(session, generation, socket)
  ) {
    return 0;
  }

  const { ingestHistoryBatch, readHistoryMessages } = await import(
    "@/server/inbox/history"
  );
  const selected = readHistoryMessages(session.historyBuffer);
  const inserted = await ingestHistoryBatch(organizationId, selected);
  await getDb()
    .update(schema.organization)
    .set({ whatsappInitialImportedAt: new Date() })
    .where(eq(schema.organization.id, organizationId));

  session.historyBuffer = newHistoryBuffer();
  session.initialImportComplete = true;
  session.syncDone = true;
  session.syncProgress = null;
  return inserted;
}

function newSession(): Session {
  return {
    ...createSessionLifecycle<WASocket>(),
    status: "unlinked",
    qr: null,
    phone: null,
    storedPhone: null,
    initialImportComplete: false,
    error: null,
    syncProgress: null,
    syncDone: false,
    historyIndex: newHistoryIndex(),
    historyBuffer: newHistoryBuffer(),
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
  if ((legacy.status as string | undefined) === "disconnected") {
    legacy.status = "unlinked";
  }
  if (legacy.socket === undefined) legacy.socket = legacy.sock ?? null;
  legacy.generation ??= 0;
  legacy.stopped ??= false;
  legacy.startPromise ??= null;
  legacy.reconnectTimer ??= null;
  legacy.error ??= null;
  legacy.storedPhone ??= null;
  legacy.initialImportComplete ??= false;
  legacy.syncProgress ??= null;
  legacy.syncDone ??= false;
  legacy.historyIndex ??= newHistoryIndex();
  legacy.historyBuffer ??= newHistoryBuffer();
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
  initialImportComplete: boolean;
} {
  const session = getSession(organizationId);
  return {
    status: session.status,
    qr: session.qr,
    phone: session.phone,
    error: session.error,
    syncProgress: session.syncProgress,
    initialImportComplete: session.initialImportComplete,
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
  session.status = "reconnecting";

  const timer = setTimeout(() => {
    if (
      session.reconnectTimer !== timer ||
      session.stopped ||
      !isCurrentSession(session, generation)
    ) {
      return;
    }
    session.reconnectTimer = null;
    session.status = "reconnecting";
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
  session.status = "reconnecting";
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
  await loadOrganizationWhatsAppState(organizationId, session);
  const { state, saveCreds } = await loadDbAuthState(organizationId);
  if (!isCurrentSession(session, generation)) return;

  // syncFullHistory: WhatsApp entrega el historial en tandas con progreso
  // real (spec 004 FR-402) en vez de un único lote mínimo.
  const socket = makeWASocket({
    auth: state,
    logger,
    syncFullHistory: false,
    shouldSyncHistoryMessage: (notification) =>
      notification.syncType !== proto.HistorySync.HistorySyncType.FULL,
  });
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
      void completeConnectionOpen(
        organizationId,
        session,
        generation,
        socket
      ).catch(() => {
        if (!isCurrentSession(session, generation, socket)) return;
        session.error = "connection_failed";
        session.status = session.initialImportComplete
          ? "reconnecting"
          : "unlinked";
        console.error("[baileys] connection_open_failed");
      });
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
      session.status = "unlinked";
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
    const {
      chats,
      contacts,
      messages,
      lidPnMappings,
      progress,
      syncType,
      chunkOrder,
    } = history;
    const stats = session.syncStats;
    let inserted = 0;

    try {
      const {
        addHistoryMessages,
        extendHistoryIndex,
        ingestHistoryBatch,
      } = await import("@/server/inbox/history");

      extendHistoryIndex(session.historyIndex, { lidPnMappings, contacts });

      const lidJids = new Set<string>();
      for (const chat of chats ?? []) {
        if (
          chat.id?.endsWith("@lid") &&
          !session.historyIndex.phone.has(chat.id)
        ) {
          lidJids.add(chat.id);
        }
      }
      for (const message of messages ?? []) {
        const jid = message.key?.remoteJid;
        if (
          jid?.endsWith("@lid") &&
          !session.historyIndex.phone.has(jid)
        ) {
          lidJids.add(jid);
        }
      }
      for (const lid of lidJids) {
        const phone = await lidToPhone(socket, lid);
        if (phone) session.historyIndex.phone.set(lid, phone);
      }

      stats.chats += chats?.length ?? 0;
      stats.messages += messages?.length ?? 0;
      stats.lidMappings = session.historyIndex.phone.size;

      const items = (messages ?? [])
        .map((message) =>
          extractHistoryMessage(message, session.historyIndex.phone)
        )
        .filter((message): message is NonNullable<typeof message> =>
          message !== null
        );

      const onDemand =
        syncType === proto.HistorySync.HistorySyncType.ON_DEMAND;
      const bootstrap =
        syncType == null ||
        syncType === proto.HistorySync.HistorySyncType.INITIAL_BOOTSTRAP ||
        syncType === proto.HistorySync.HistorySyncType.RECENT;
      const terminal =
        syncType === proto.HistorySync.HistorySyncType.RECENT &&
        typeof progress === "number" &&
        progress >= 100;

      if (onDemand && items.length > 0) {
        inserted = await ingestHistoryBatch(organizationId, items);
        stats.messagesIngested += inserted;
      } else if (bootstrap && !session.syncDone) {
        addHistoryMessages(session.historyBuffer, items);
        session.syncProgress = progress ?? session.syncProgress ?? 0;

        if (terminal) {
          inserted = await finalizeBufferedHistory(
            organizationId,
            session,
            generation,
            socket
          );
          stats.messagesIngested += inserted;
        }
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "unknown";
      console.error(`[baileys] history_ingest_failed kind=${name}`);
    }

    stats.events += 1;
    stats.updatedAt = new Date().toISOString();
    console.info(
      `[history] type=${syncType ?? "unknown"} chunk=${chunkOrder ?? "unknown"} progress=${progress ?? "unknown"} chats=${chats?.length ?? 0} msgs=${messages?.length ?? 0} selected=${session.historyBuffer.size} inserted=${inserted} idx=${stats.lidMappings}`
    );

    if (!isCurrentSession(session, generation, socket)) return;
    publish(organizationId, {
      type: "channel.sync",
      data: { progress: session.syncProgress, inserted },
    });
  });

  socket.ev.on("messaging-history.status", (update) => {
    if (
      update.syncType !== proto.HistorySync.HistorySyncType.RECENT ||
      update.status !== "paused" ||
      !isCurrentSession(session, generation, socket)
    ) {
      return;
    }
    void finalizeBufferedHistory(
      organizationId,
      session,
      generation,
      socket
    )
      .then((inserted) => {
        session.syncStats.messagesIngested += inserted;
        publish(organizationId, {
          type: "channel.sync",
          data: { progress: null, inserted },
        });
      })
      .catch(() => console.error("[baileys] history_finalize_failed"));
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" || !isCurrentSession(session, generation, socket)) {
      return;
    }
    const { ingestInboundMessage } = await import("@/server/inbox/ingest");
    const { ingestObservedOutgoingMessage } = await import(
      "@/server/inbox/history"
    );

    for (const message of messages) {
      try {
        if (!isCurrentSession(session, generation, socket)) return;

        let item = extractHistoryMessage(
          message,
          session.historyIndex.phone
        );
        const remoteJid = message.key?.remoteJid;
        if (!item && remoteJid?.endsWith("@lid")) {
          const phone = await lidToPhone(socket, remoteJid);
          if (phone) {
            session.historyIndex.phone.set(remoteJid, phone);
            item = extractHistoryMessage(
              message,
              session.historyIndex.phone
            );
          }
        }
        if (!item) continue;

        if (item.direction === "out") {
          await ingestObservedOutgoingMessage(organizationId, item);
          continue;
        }

        await ingestInboundMessage({
          organizationId,
          from: item.phone,
          profileName: message.pushName ?? null,
          waMessageId: item.waMessageId,
          type: item.type,
          text: item.text,
          timestamp: item.timestamp,
        });
      } catch {
        console.error("[baileys] live_message_ingest_failed");
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
      session.status === "connected" ||
      session.status === "reconnecting")
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
  session.historyBuffer = newHistoryBuffer();
  session.syncStats = newSyncStats();

  const tracked = openSession(organizationId, session, generation)
    .catch((error) => {
      if (isCurrentSession(session, generation)) {
        session.socket = null;
        session.status = session.initialImportComplete
          ? "reconnecting"
          : "unlinked";
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

export type OlderHistoryRequestResult =
  | { requested: true; requestId: string }
  | { requested: false; reason: "not_found" | "empty" };

/** Requests the previous WhatsApp page for one known direct conversation. */
export async function requestOlderHistory(
  organizationId: string,
  conversationId: string
): Promise<OlderHistoryRequestResult> {
  const session = getSession(organizationId);
  if (session.status !== "connected" || !session.socket) {
    throw new ChannelError(
      "history_unavailable",
      "WhatsApp must be connected before requesting older history"
    );
  }

  const db = getDb();
  const conversations = await db
    .select({ phone: schema.contact.phone })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, conversationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const conversation = conversations[0];
  if (!conversation) return { requested: false, reason: "not_found" };

  const messages = await db
    .select({
      waMessageId: schema.message.waMessageId,
      direction: schema.message.direction,
      waTimestamp: schema.message.waTimestamp,
      createdAt: schema.message.createdAt,
    })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conversationId),
        isNotNull(schema.message.waMessageId)
      )
    )
    .orderBy(asc(schema.message.waTimestamp), asc(schema.message.createdAt))
    .limit(1);
  const oldest = messages[0];
  if (!oldest?.waMessageId) return { requested: false, reason: "empty" };

  try {
    const requestId = await session.socket.fetchMessageHistory(
      50,
      {
        remoteJid: toJid(conversation.phone),
        id: oldest.waMessageId,
        fromMe: oldest.direction === "out",
      },
      (oldest.waTimestamp ?? oldest.createdAt).getTime()
    );
    return { requested: true, requestId };
  } catch {
    throw new ChannelError(
      "history_unavailable",
      "WhatsApp could not provide older history"
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
  session.status = "unlinked";
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