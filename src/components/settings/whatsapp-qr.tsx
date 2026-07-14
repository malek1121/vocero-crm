"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, QrCode, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getChannelErrorMessage,
  type ChannelErrorCode,
} from "@/components/settings/whatsapp-state";

type ChannelState = {
  status: "unlinked" | "connecting" | "qr" | "connected" | "reconnecting";
  phone: string | null;
  qrDataUrl: string | null;
  error: ChannelErrorCode | null;
  syncProgress: number | null;
  initialImportComplete: boolean;
  canManage: boolean;
};

const COPY = {
  description:
    "Conecta tu n\u00famero desde WhatsApp > Dispositivos vinculados > Vincular un dispositivo.",
  queryError: "No se pudo consultar el estado de WhatsApp.",
  connectError: "No se pudo iniciar la conexi\u00f3n de WhatsApp.",
  disconnectError: "No se pudo cerrar la sesi\u00f3n de WhatsApp.",
  disconnectConfirm:
    "\u00bfCerrar la sesi\u00f3n de WhatsApp? Tendr\u00e1s que volver a escanear el QR.",
  loading: "Cargando las conversaciones recientes",
  connected: "Conectado",
  qrAlt: "C\u00f3digo QR para vincular WhatsApp",
  qrRefresh: "El c\u00f3digo se renueva solo si expira.",
  connecting: "Preparando la conexi\u00f3n...",
  reconnecting: "Reconectando con WhatsApp...",
  unlinked: "WhatsApp no est\u00e1 vinculado. Conecta el n\u00famero para abrir la bandeja.",
  ownerRequired: "Pide al propietario de la organizaci\u00f3n que vincule WhatsApp.",
};

const POLL_MS = 2000;

export function WhatsappQr() {
  const [state, setState] = useState<ChannelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/whatsapp", {
        cache: "no-store",
      });
      if (!response.ok) {
        setError(COPY.queryError);
        return;
      }
      const nextState = (await response.json()) as ChannelState;
      setState(nextState);
      setError(getChannelErrorMessage(nextState.error));
    } catch {
      setError(COPY.queryError);
    }
  }, []);

  useEffect(() => {
    void refetch();
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/whatsapp", { method: "POST" });
      if (!response.ok) {
        setError(COPY.connectError);
        return;
      }
      await refetch();
    } catch {
      setError(COPY.connectError);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(COPY.disconnectConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/whatsapp", {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(COPY.disconnectError);
        return;
      }
      await refetch();
    } catch {
      setError(COPY.disconnectError);
    } finally {
      setBusy(false);
    }
  }

  const status = state?.status ?? "unlinked";
  const importing =
    status === "connected" && !state?.initialImportComplete;

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>{COPY.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="status" aria-live="polite" aria-atomic="true">
            {importing && (
              <div className="space-y-2 rounded-md border border-brand-soft bg-brand-tint p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                  <span>
                    {COPY.loading}... {Math.round(state?.syncProgress ?? 0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-soft">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${Math.round(state?.syncProgress ?? 0)}%` }}
                  />
                </div>
              </div>
            )}

            {status === "connected" && !importing && (
              <div className="flex items-center gap-2 rounded-md border border-brand-soft bg-brand-tint p-3 text-sm">
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>
                  {COPY.connected}{state?.phone ? ` como +${state.phone}` : ""}.
                </span>
              </div>
            )}

            {status === "qr" && state?.qrDataUrl && (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.qrDataUrl}
                  alt={COPY.qrAlt}
                  className="h-56 w-56 rounded-md border bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">{COPY.qrRefresh}</p>
              </div>
            )}

            {(status === "connecting" || status === "reconnecting") && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {status === "reconnecting" ? COPY.reconnecting : COPY.connecting}
              </div>
            )}

            {status === "unlinked" && (
              <p className="text-sm text-muted-foreground">
                {state?.canManage === false ? COPY.ownerRequired : COPY.unlinked}
              </p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert" aria-live="assertive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {status === "unlinked" && state?.canManage === true && (
              <Button onClick={() => void connect()} disabled={busy} aria-busy={busy}>
                <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
                Conectar
              </Button>
            )}
            {status !== "unlinked" && state?.canManage !== false && (
              <Button
                variant="outline"
                onClick={() => void disconnect()}
                disabled={busy}
                aria-busy={busy}
              >
                <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                Desconectar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
