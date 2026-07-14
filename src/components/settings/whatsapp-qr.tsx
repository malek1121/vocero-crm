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
  status: "disconnected" | "connecting" | "qr" | "connected";
  phone: string | null;
  qrDataUrl: string | null;
  error: ChannelErrorCode | null;
  syncProgress: number | null;
};

const POLL_MS = 2000;

export function WhatsappQr() {
  const [state, setState] = useState<ChannelState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/whatsapp", { cache: "no-store" });
      if (!res.ok) {
        setError("No se pudo consultar el estado de WhatsApp.");
        return;
      }

      const nextState = (await res.json()) as ChannelState;
      setState(nextState);
      setError(getChannelErrorMessage(nextState.error));
    } catch {
      setError("No se pudo consultar el estado de WhatsApp.");
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
      const res = await fetch("/api/settings/whatsapp", { method: "POST" });
      if (!res.ok) {
        setError("No se pudo iniciar la conexión de WhatsApp.");
        return;
      }
      await refetch();
    } catch {
      setError("No se pudo iniciar la conexión de WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "¿Cerrar la sesión de WhatsApp? Tendrás que volver a escanear el QR."
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/whatsapp", { method: "DELETE" });
      if (!res.ok) {
        setError("No se pudo cerrar la sesión de WhatsApp.");
        return;
      }
      await refetch();
    } catch {
      setError("No se pudo cerrar la sesión de WhatsApp.");
    } finally {
      setBusy(false);
    }
  }

  const status = state?.status ?? "disconnected";

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
          <CardDescription>
            Conecta tu número escaneando el QR desde el teléfono: WhatsApp →
            Dispositivos vinculados → Vincular un dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="status" aria-live="polite" aria-atomic="true">
            {status === "connected" &&
              typeof state?.syncProgress === "number" && (
                <div className="space-y-2 rounded-md border border-brand-soft bg-brand-tint p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Loader2
                      className="h-4 w-4 animate-spin text-primary"
                      aria-hidden="true"
                    />
                    <span>
                      Cargando mensajes… {Math.round(state.syncProgress)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-brand-soft">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${Math.round(state.syncProgress)}%` }}
                    />
                  </div>
                </div>
              )}

            {status === "connected" && state?.syncProgress == null && (
              <div className="flex items-center gap-2 rounded-md border border-brand-soft bg-brand-tint p-3 text-sm">
                <CheckCircle2
                  className="h-4 w-4 text-primary"
                  aria-hidden="true"
                />
                <span>
                  Conectado{state?.phone ? ` como +${state.phone}` : ""}. Los
                  mensajes entran y salen por este número.
                </span>
              </div>
            )}

            {status === "qr" && state?.qrDataUrl && (
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={state.qrDataUrl}
                  alt="Código QR para vincular WhatsApp"
                  className="h-56 w-56 rounded-md border bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">
                  El código se renueva solo; si expira, aparece uno nuevo.
                </p>
              </div>
            )}

            {status === "connecting" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                Conectando…
              </div>
            )}

            {status === "disconnected" && (
              <p className="text-sm text-muted-foreground">
                Sin sesión activa. Pulsa Conectar para generar el código QR.
              </p>
            )}
          </div>

          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </p>
          )}

          <div className="flex gap-2">
            {status === "disconnected" && (
              <Button
                onClick={() => void connect()}
                disabled={busy}
                aria-busy={busy}
              >
                <QrCode className="mr-2 h-4 w-4" aria-hidden="true" />
                Conectar
              </Button>
            )}
            {status !== "disconnected" && (
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