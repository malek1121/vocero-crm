import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "process_restarted",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] orphan_run_cleanup_failed");
  }
}

/** Reanuda las sesiones Baileys guardadas (spec 002 FR-B02). */
export async function resumeWhatsappSessions(): Promise<void> {
  try {
    const { resumeStoredSessions } = await import("@/server/baileys/manager");
    await resumeStoredSessions();
  } catch {
    console.error("[boot] whatsapp_resume_failed");
  }
}
/** Reanuda trabajo durable del agente pendiente o con lease vencido. */
export async function resumeAgentWork(): Promise<void> {
  try {
    const { resumeAgentDispatches } = await import("@/server/ai/dispatch");
    await resumeAgentDispatches();
  } catch {
    console.error("[boot] agent_dispatch_resume_failed");
  }
}