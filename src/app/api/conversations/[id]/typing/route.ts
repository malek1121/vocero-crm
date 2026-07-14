import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { parseBody, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { sendChannelTyping } from "@/server/baileys/manager";

export const dynamic = "force-dynamic";

const typingSchema = z.object({ state: z.enum(["composing", "paused"]) });

type Params = { params: Promise<{ id: string }> };

/** Emite "escribiendo…" del operador hacia el contacto (spec 004 FR-412). */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, typingSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const rows = await db
    .select({ phone: schema.contact.phone })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.id, id),
        eq(schema.conversation.organizationId, session.organizationId),
        eq(schema.conversation.isTest, false)
      )
    )
    .limit(1);
  const phone = rows[0]?.phone;
  if (phone) {
    await sendChannelTyping(session.organizationId, phone, body.data.state);
  }
  return Response.json({ ok: true });
});
