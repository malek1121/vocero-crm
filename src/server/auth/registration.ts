import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

/** Public signup is only available for the first owner of an empty instance. */
export async function isPublicSignupAllowed(): Promise<boolean> {
  const db = getDb();
  const rows = await db.select({ n: count() }).from(schema.organization);
  return (rows[0]?.n ?? 0) === 0;
}