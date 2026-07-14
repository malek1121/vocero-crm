import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** Sesión de better-auth, deduplicada por request (spec 003 FR-P01). */
export const getAuthSession = cache(async () => {
  return getAuth().api.getSession({ headers: await headers() });
});

/**
 * Sesión + organización activa para route handlers y server components.
 * Lanza UnauthorizedError si no hay sesión u organización.
 * Deduplicada por request: múltiples llamadas = una sola resolución.
 */
export const requireSession = cache(async (): Promise<SessionContext> => {
  const session = await getAuthSession();
  if (!session) throw new UnauthorizedError();
  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
  };
});

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
