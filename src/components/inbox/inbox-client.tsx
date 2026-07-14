"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, ArchiveRestore, Loader2, PanelRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { WhatsappQr } from "@/components/settings/whatsapp-qr";
import type { ConversationDto, MessageDto } from "@/lib/types";
import { apiRequest } from "@/lib/client-api";
import { useEvents } from "@/components/use-events";
import { ConversationList } from "./conversation-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { ContactPanel } from "./contact-panel";

type WhatsappInboxState = {
  status: "unlinked" | "connecting" | "qr" | "connected" | "reconnecting";
  initialImportComplete: boolean;
  syncProgress: number | null;
};

export function InboxClient() {
  const [conversations, setConversations] = useState<ConversationDto[] | null>(
    null
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [messageCursor, setMessageCursor] = useState<string | null>(null);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  // Se incrementa con cada evento SSE que puede cambiar la etapa/lead o el
  // estado del agente: el panel de detalles lo observa y refetch en vivo.
  const [detailRev, setDetailRev] = useState(0);
  // Progreso de sync de historial al vincular (spec 004 FR-402); null = sin sync.
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  const [channelState, setChannelState] = useState<WhatsappInboxState | null>(null);
  const [remoteHistoryPending, setRemoteHistoryPending] = useState(false);
  const [remoteHistoryExhausted, setRemoteHistoryExhausted] = useState(false);
  // Filtro Activas/Archivadas (spec 004 FR-421).
  const [showArchived, setShowArchived] = useState(false);
  // Teléfono del contacto que está "escribiendo…" (spec 004 FR-412).
  const [typingPhone, setTypingPhone] = useState<string | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetchChannelState = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/whatsapp", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const state = (await response.json()) as WhatsappInboxState;
      setChannelState(state);
      setSyncProgress(state.syncProgress);
    } catch {
      // The next poll retries without hiding an already loaded inbox.
    }
  }, []);

  useEffect(() => {
    void refetchChannelState();
    const id = setInterval(() => void refetchChannelState(), 2000);
    return () => clearInterval(id);
  }, [refetchChannelState]);

  useEffect(() => {
    setPanelOpen(localStorage.getItem("vocero.panelOpen") !== "false");
  }, []);

  useEffect(() => {
    if (!remoteHistoryPending) return;
    const id = setTimeout(() => {
      setRemoteHistoryPending(false);
      setError("WhatsApp no respondio con mas mensajes. Puedes intentarlo otra vez.");
    }, 30000);
    return () => clearTimeout(id);
  }, [remoteHistoryPending]);
  const togglePanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    localStorage.setItem("vocero.panelOpen", String(open));
  }, []);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const refetchConversations = useCallback(async () => {
    const url = showArchived ? "/api/conversations?archived=1" : "/api/conversations";
    try {
      const data = await apiRequest<{ conversations: ConversationDto[]; nextCursor: string | null }>(
        url,
        { cache: "no-store" },
        "No se pudieron cargar las conversaciones"
      );
      setConversations(data.conversations);
      setConversationCursor(data.nextCursor);
      setError(null);
    } catch (requestError) {
      setConversations((current) => current ?? []);
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las conversaciones");
    }
  }, [showArchived]);

  const loadMoreConversations = useCallback(async () => {
    if (!conversationCursor || loadingMoreConversations) return;
    setLoadingMoreConversations(true);
    try {
      const params = new URLSearchParams({ before: conversationCursor });
      if (showArchived) params.set("archived", "1");
      const data = await apiRequest<{ conversations: ConversationDto[]; nextCursor: string | null }>(
        `/api/conversations?${params}`,
        { cache: "no-store" },
        "No se pudieron cargar m?s conversaciones"
      );
      setConversations((current) => {
        const known = new Set((current ?? []).map((conversation) => conversation.id));
        return [...(current ?? []), ...data.conversations.filter((conversation) => !known.has(conversation.id))];
      });
      setConversationCursor(data.nextCursor);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar m?s conversaciones");
    } finally {
      setLoadingMoreConversations(false);
    }
  }, [conversationCursor, loadingMoreConversations, showArchived]);

  const refetchMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await apiRequest<{ messages: MessageDto[]; nextCursor: string | null }>(
        `/api/conversations/${conversationId}/messages`,
        { cache: "no-store" },
        "No se pudieron cargar los mensajes"
      );
      if (selectedIdRef.current === conversationId) {
        setMessages(data.messages);
        setMessageCursor(data.nextCursor);
      }
      setError(null);
    } catch (requestError) {
      if (selectedIdRef.current === conversationId) {
        setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar los mensajes");
      }
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const conversationId = selectedIdRef.current;
    if (
      !conversationId ||
      loadingOlderMessages ||
      remoteHistoryPending
    ) {
      return;
    }

    setLoadingOlderMessages(true);
    try {
      if (messageCursor) {
        const data = await apiRequest<{
          messages: MessageDto[];
          nextCursor: string | null;
        }>(
          `/api/conversations/${conversationId}/messages?before=${encodeURIComponent(messageCursor)}`,
          { cache: "no-store" },
          "No se pudieron cargar los mensajes anteriores"
        );
        if (selectedIdRef.current === conversationId) {
          setMessages((current) => {
            const known = new Set(current.map((message) => message.id));
            return [
              ...data.messages.filter((message) => !known.has(message.id)),
              ...current,
            ];
          });
          setMessageCursor(data.nextCursor);
        }
      } else {
        if (
          channelState?.status !== "connected" ||
          remoteHistoryExhausted
        ) {
          return;
        }
        const result = await apiRequest<
          | { requested: true; requestId: string }
          | { requested: false; reason: "empty" }
        >(
          `/api/conversations/${conversationId}/history`,
          { method: "POST" },
          "No se pudo solicitar el historial anterior"
        );
        if (result.requested) setRemoteHistoryPending(true);
        else setRemoteHistoryExhausted(true);
      }
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudieron cargar los mensajes anteriores"
      );
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [
    channelState?.status,
    loadingOlderMessages,
    messageCursor,
    remoteHistoryExhausted,
    remoteHistoryPending,
  ]);

  const inboxAvailable = Boolean(
    channelState?.initialImportComplete &&
      (channelState.status === "connected" ||
        channelState.status === "reconnecting")
  );

  useEffect(() => {
    if (inboxAvailable) void refetchConversations();
  }, [inboxAvailable, refetchConversations]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setMessages([]);
      setMessageCursor(null);
      setRemoteHistoryPending(false);
      setRemoteHistoryExhausted(false);
      // Selección en la URL (spec 003 FR-P02): replaceState nativo = shallow,
      // no re-renderiza el server; al volver a /inbox se restaura.
      const url = new URL(window.location.href);
      url.searchParams.set("c", id);
      url.searchParams.delete("contact");
      window.history.replaceState(null, "", url);
      void refetchMessages(id);
      void fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markRead: true }),
      });
    },
    [refetchMessages]
  );

  // Deep-links: /inbox?c=<conversationId> (selección persistida) y
  // /inbox?contact=<contactId> (enlace desde Contactos/Pipeline).
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  const conversationParam = searchParams.get("c");
  useEffect(() => {
    if (selectedIdRef.current || !conversations) return;
    if (conversationParam) {
      if (conversations.some((c) => c.id === conversationParam)) {
        select(conversationParam);
      }
      return;
    }
    if (contactParam) {
      const match = conversations.find((c) => c.contact.id === contactParam);
      if (match) select(match.id);
    }
  }, [conversationParam, contactParam, conversations, select]);

  useEvents({
    onMessageNew: ({ conversationId, message }) => {
      if (selectedIdRef.current === conversationId) {
        const m = message as MessageDto;
        setMessages((prev) =>
          prev.some((x) => x.id === m.id) ? prev : [...prev, m]
        );
        void fetch(`/api/conversations/${conversationId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markRead: true }),
        });
      }
      void refetchConversations();
      // Un entrante nuevo puede crear/mover el lead: refresca el panel.
      setDetailRev((v) => v + 1);
    },
    onMessageStatus: ({ conversationId, messageId, status }) => {
      if (selectedIdRef.current !== conversationId) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: status as MessageDto["status"] } : m
        )
      );
    },
    onConversationUpdated: () => {
      void refetchConversations();
      // El agente movió de etapa o cambió el handoff: refresca el panel en vivo.
      setDetailRev((v) => v + 1);
    },
    onReconnect: () => {
      // Catch-up tras reconexión (contrato sse.md): refetch completo.
      void refetchConversations();
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      setDetailRev((v) => v + 1);
    },
    onChannelSync: ({ progress, inserted }) => {
      setSyncProgress(progress);
      if (progress === null) {
        setChannelState((current) =>
          current
            ? { ...current, initialImportComplete: true, syncProgress: null }
            : current
        );
      }
      if (inserted > 0) {
        void refetchConversations();
        if (selectedIdRef.current) {
          void refetchMessages(selectedIdRef.current);
        }
      }
      if (remoteHistoryPending) {
        if (inserted === 0) setRemoteHistoryExhausted(true);
        setRemoteHistoryPending(false);
        if (selectedIdRef.current) {
          void refetchMessages(selectedIdRef.current);
        }
      }
    },
    onPresence: ({ phone, composing }) => {
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      if (!composing) {
        setTypingPhone(null);
        return;
      }
      setTypingPhone(phone);
      // Auto-expira: WhatsApp no siempre manda "paused" al dejar de escribir.
      typingTimerRef.current = setTimeout(() => setTypingPhone(null), 6000);
    },
  });

  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  const sendText = useCallback(
    async (
      text: string,
      idempotencyKey: string
    ): Promise<string | null> => {
      if (!selectedIdRef.current) return "Sin conversación seleccionada";
      const res = await fetch(
        `/api/conversations/${selectedIdRef.current}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, idempotencyKey }),
        }
      ).catch(() => null);
      if (!res) return "Sin conexión con el servidor";
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        return data?.error?.message ?? "No se pudo enviar el mensaje";
      }
      if (selectedIdRef.current) void refetchMessages(selectedIdRef.current);
      void refetchConversations();
      return null;
    },
    [refetchMessages, refetchConversations]
  );

  const patchConversation = useCallback(
    async (patch: {
      aiEnabled?: boolean;
      reactivate?: boolean;
      archived?: boolean;
    }): Promise<boolean> => {
      const conversationId = selectedIdRef.current;
      if (!conversationId) return false;
      try {
        await apiRequest(
          `/api/conversations/${conversationId}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(patch),
          },
          "No se pudo actualizar la conversaci?n"
        );
        await refetchConversations();
        setError(null);
        return true;
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "No se pudo actualizar la conversaci?n");
        return false;
      }
    },
    [refetchConversations]
  );

  const emitTyping = useCallback((state: "composing" | "paused") => {
    const id = selectedIdRef.current;
    if (!id) return;
    void fetch(`/api/conversations/${id}/typing`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    }).catch(() => {});
  }, []);

  const toggleArchive = useCallback(async () => {
    if (!selected) return;
    // Al (des)archivar, la conversación sale del filtro actual: limpiar selección.
    const updated = await patchConversation({ archived: !selected.archived });
    if (!updated) return;
    setSelectedId(null);
    setMessages([]);
    setMessageCursor(null);
  }, [selected, patchConversation]);

  if (!channelState) {
    return (
      <div className="flex h-full items-center justify-center bg-chat">
        <Loader2
          className="h-6 w-6 animate-spin text-brand"
          aria-label="Cargando WhatsApp"
        />
      </div>
    );
  }

  if (!inboxAvailable) {
    return (
      <div className="h-full overflow-y-auto bg-chat">
        <WhatsappQr />
      </div>
    );
  }

  return (
    <div className="relative flex h-full">
      {(syncProgress !== null || channelState.status === "reconnecting") && (
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-3 border-b bg-brand-tint px-4 py-2 text-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" strokeWidth={1.8} />
          <span className="shrink-0 font-medium text-brand-text">
            {channelState.status === "reconnecting"
              ? "Reconectando con WhatsApp..."
              : `Cargando mensajes... ${Math.round(syncProgress ?? 0)}%`}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-brand-soft">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300"
              style={{ width: `${Math.round(syncProgress ?? 0)}%` }}
            />
          </div>
        </div>
      )}
      <section className="flex w-[360px] shrink-0 flex-col overflow-hidden border-r">
        <div className="flex gap-1 border-b bg-background p-2">
          {([false, true] as const).map((archived) => (
            <button
              key={String(archived)}
              onClick={() => {
                setShowArchived(archived);
                setSelectedId(null);
                setMessages([]);
              }}
              className={cn(
                "flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
                showArchived === archived
                  ? "bg-brand-tint text-brand-text"
                  : "text-text-3 hover:bg-accent"
              )}
            >
              {archived ? "Archivadas" : "Activas"}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <ConversationList
            conversations={conversations}
            selectedId={selectedId}
            onSelect={select}
            onSeeded={() => void refetchConversations()}
            hasMore={Boolean(conversationCursor)}
            loadingMore={loadingMoreConversations}
            onLoadMore={() => void loadMoreConversations()}
          />
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center justify-between border-b bg-background px-4 py-2.5">
              <div className="flex items-center gap-3">
                <ContactAvatar
                  name={selected.contact.name}
                  seed={selected.contact.id}
                  size="md"
                />
                <div>
                  <p className="text-[15px] font-[650] leading-tight">
                    {selected.contact.name}
                  </p>
                  {typingPhone === selected.contact.phone ? (
                    <p className="text-xs font-medium text-brand">escribiendo…</p>
                  ) : (
                    <p className="text-xs text-text-3">
                      +{selected.contact.phone}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => void toggleArchive()}
                  aria-label={selected.archived ? "Desarchivar" : "Archivar"}
                  title={selected.archived ? "Desarchivar" : "Archivar"}
                  className="rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
                >
                  {selected.archived ? (
                    <ArchiveRestore className="h-4 w-4" strokeWidth={1.7} />
                  ) : (
                    <Archive className="h-4 w-4" strokeWidth={1.7} />
                  )}
                </button>
                {!panelOpen && (
                  <button
                    onClick={() => togglePanel(true)}
                    aria-label="Mostrar detalles"
                    className="rounded-sm border p-1.5 text-text-3 hover:bg-accent hover:text-foreground"
                  >
                    <PanelRight className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                )}
              </div>
            </header>
            <MessageThread
              messages={messages}
              hasOlder={
                Boolean(messageCursor) ||
                (channelState.status === "connected" &&
                  !remoteHistoryExhausted)
              }
              loadingOlder={loadingOlderMessages || remoteHistoryPending}
              onLoadOlder={() => void loadOlderMessages()}
            />
            <Composer onSend={sendText} onTyping={emitTyping} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center bg-chat text-sm text-text-3">
            Elige una conversación para ver el hilo
          </div>
        )}
      </section>

      {error && (
        <p
          role="alert"
          className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-md border border-destructive/30 bg-background px-4 py-2 text-sm text-destructive shadow-lg"
        >
          {error}
        </p>
      )}

      <section
        className={cn(
          "shrink-0 overflow-hidden border-l transition-[width] duration-[220ms]",
          panelOpen && selected ? "w-[320px]" : "w-0 border-l-0"
        )}
      >
        {selected && (
          <div className="h-full w-[320px]">
            <ContactPanel
              conversation={selected}
              refreshKey={detailRev}
              onPatchConversation={patchConversation}
              onClose={() => togglePanel(false)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
