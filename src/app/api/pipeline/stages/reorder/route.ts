import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { resolveStageSwap } from "@/server/pipeline/stage-reorder";

export const dynamic = "force-dynamic";

const reorderSchema = z
  .object({
    stageId: z.string().min(1),
    swapWithId: z.string().min(1),
  })
  .refine((body) => body.stageId !== body.swapWithId, {
    message: "Las etapas deben ser distintas",
  });

export const POST = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, reorderSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const stages = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: schema.pipelineStage.id, position: schema.pipelineStage.position })
      .from(schema.pipelineStage)
      .where(
        scoped(
          schema.pipelineStage.organizationId,
          session.organizationId,
          inArray(schema.pipelineStage.id, [body.data.stageId, body.data.swapWithId])
        )
      );
    const first = rows.find((stage) => stage.id === body.data.stageId);
    const second = rows.find((stage) => stage.id === body.data.swapWithId);
    if (!first || !second) return null;

    const updates = resolveStageSwap(first, second);
    for (const update of updates) {
      await tx
        .update(schema.pipelineStage)
        .set({ position: update.position })
        .where(
          scoped(
            schema.pipelineStage.organizationId,
            session.organizationId,
            eq(schema.pipelineStage.id, update.id)
          )
        );
    }
    return updates;
  });

  if (!stages) return apiError(404, "not_found", "Etapa no encontrada");
  return Response.json({ stages });
});