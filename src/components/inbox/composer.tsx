"use client";

import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPendingSendRequest } from "@/components/inbox/send-request";

export function Composer({
  onSend,
  onTyping,
}: {
  onSend: (text: string, idempotencyKey: string) => Promise<string | null>;
  onTyping?: (state: "composing" | "paused") => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingRequestRef = useRef<{
    text: string;
    idempotencyKey: string;
  } | null>(null);
  // Throttle del "escribiendo…": composing como mucho cada 2s; paused tras 3s idle.
  const composingSentAtRef = useRef(0);
  const pausedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function signalTyping() {
    if (!onTyping) return;
    const now = Date.now();
    if (now - composingSentAtRef.current > 2000) {
      composingSentAtRef.current = now;
      onTyping("composing");
    }
    if (pausedTimerRef.current) clearTimeout(pausedTimerRef.current);
    pausedTimerRef.current = setTimeout(() => {
      composingSentAtRef.current = 0;
      onTyping("paused");
    }, 3000);
  }

  function stopTyping() {
    if (pausedTimerRef.current) clearTimeout(pausedTimerRef.current);
    composingSentAtRef.current = 0;
    onTyping?.("paused");
  }

  function autogrow() {
    const element = taRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;

    const request = getPendingSendRequest(pendingRequestRef.current, value);
    pendingRequestRef.current = request;

    setSending(true);
    setError(null);
    try {
      const sendError = await onSend(value, request.idempotencyKey);
      if (sendError) {
        setError(sendError);
        return;
      }

      pendingRequestRef.current = null;
      setText("");
      stopTyping();
      if (taRef.current) taRef.current.style.height = "auto";
    } catch {
      setError("No se pudo enviar el mensaje");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t bg-background px-[18px] pb-3.5 pt-3">
      <div className="flex items-end gap-2 rounded-md border bg-background px-3 py-2 transition-shadow focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <textarea
          ref={taRef}
          placeholder="Escribe una respuesta…"
          value={text}
          rows={1}
          onChange={(event) => {
            const nextText = event.target.value;
            setText(nextText);
            if (pendingRequestRef.current?.text !== nextText.trim()) {
              pendingRequestRef.current = null;
            }
            if (nextText.trim()) signalTyping();
            autogrow();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="max-h-[120px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-text-3"
        />
        <button
          onClick={() => void submit()}
          disabled={sending || text.trim().length === 0}
          aria-label="Enviar"
          aria-busy={sending}
          className={cn(
            "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand text-white transition-opacity hover:bg-brand-hover",
            (sending || !text.trim()) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}