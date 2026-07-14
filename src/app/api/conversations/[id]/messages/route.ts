import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { decodeCursor } from "@/server/inbox/cursor";
import { getConversation, listMessages } from "@/server/inbox/queries";
import { serializeMessage } from "@/server/inbox/ingest";
import { SendError, sendText } from "@/server/inbox/send";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const GET = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const row = await getConversation(session.organizationId, id);
  if (!row) return apiError(404, "not_found", "Conversación no encontrada");

  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const beforeParam = url.searchParams.get("before");
  const before = decodeCursor(beforeParam);
  if (beforeParam && !before) {
    return apiError(400, "invalid_cursor", "Cursor inválido");
  }

  const page = await listMessages(session.organizationId, id, {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    before: before ?? undefined,
  });
  return Response.json({
    messages: page.messages.map(serializeMessage),
    nextCursor: page.nextCursor,
  });
});

const sendSchema = z.object({
  text: z.string().trim().min(1).max(4096),
  idempotencyKey: z.string().uuid(),
});

const SEND_ERROR_STATUS: Record<SendError["code"], number> = {
  sandbox_violation: 403,
  idempotency_conflict: 409,
  not_connected: 503,
  send_failed: 502,
};

export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, sendSchema);
  if (!body.ok) return body.response;

  try {
    const result = await sendText({
      conversationId: id,
      organizationId: session.organizationId,
      text: body.data.text,
      idempotencyKey: body.data.idempotencyKey,
    });
    const status =
      result.deliveryState === "sent" ? (result.created ? 201 : 200) : 202;
    return Response.json(result, { status });
  } catch (error) {
    if (error instanceof SendError) {
      return apiError(SEND_ERROR_STATUS[error.code], error.code, error.message);
    }
    throw error;
  }
});