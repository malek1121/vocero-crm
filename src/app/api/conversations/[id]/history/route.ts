import { apiError, withAuth } from "@/lib/api";
import {
  ChannelError,
  requestOlderHistory,
} from "@/server/baileys/manager";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export const POST = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    const result = await requestOlderHistory(session.organizationId, id);
    if (!result.requested && result.reason === "not_found") {
      return apiError(404, "not_found", "Conversation not found");
    }
    return Response.json(result, { status: result.requested ? 202 : 200 });
  } catch (error) {
    if (error instanceof ChannelError && error.code === "history_unavailable") {
      return apiError(503, error.code, error.message);
    }
    throw error;
  }
});
