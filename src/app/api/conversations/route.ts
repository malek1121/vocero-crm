import { apiError, withAuth } from "@/lib/api";
import { decodeCursor } from "@/server/inbox/cursor";
import { listConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const beforeParam = url.searchParams.get("before");
  const before = decodeCursor(beforeParam);
  if (beforeParam && !before) {
    return apiError(400, "invalid_cursor", "Cursor inválido");
  }

  const page = await listConversations(session.organizationId, {
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    archived: url.searchParams.get("archived") === "1",
    before: before ?? undefined,
  });
  return Response.json(page);
});