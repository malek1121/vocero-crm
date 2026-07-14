import QRCode from "qrcode";
import { apiError, withAuth } from "@/lib/api";
import { getChannelOwnerError } from "@/server/baileys/access";
import {
  getChannelStatus,
  getSyncStats,
  logoutSession,
  startSession,
} from "@/server/baileys/manager";

export const dynamic = "force-dynamic";

function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function ownerOnly(role: string): Response | null {
  const error = getChannelOwnerError(role);
  return error
    ? noStore(apiError(error.status, error.code, error.message))
    : null;
}

/** Estado de la conexión Baileys; incluye el QR como data URL si aplica. */
export const GET = withAuth(async (session) => {
  const denied = ownerOnly(session.role);
  if (denied) return denied;

  const state = getChannelStatus(session.organizationId);
  const qrDataUrl = state.qr ? await QRCode.toDataURL(state.qr) : null;
  return noStore(
    Response.json({
      status: state.status,
      phone: state.phone,
      qrDataUrl,
      error: state.error,
      syncProgress: state.syncProgress,
      sync: getSyncStats(session.organizationId),
    })
  );
});

/** Inicia o reinicia la conexión; genera QR si no hay sesión guardada. */
export const POST = withAuth(async (session) => {
  const denied = ownerOnly(session.role);
  if (denied) return denied;

  await startSession(session.organizationId);
  return noStore(Response.json({ ok: true }));
});

/** Cierra sesión y borra las credenciales guardadas. */
export const DELETE = withAuth(async (session) => {
  const denied = ownerOnly(session.role);
  if (denied) return denied;

  await logoutSession(session.organizationId);
  return noStore(Response.json({ ok: true }));
});