import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getAuth, runInternalSignup } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";
import {
  TeamAccountError,
  createTeamAccount,
  type TeamAccountDependencies,
} from "@/server/auth/team-account";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const db = getDb();
  const members = await db
    .select({
      id: schema.member.id,
      role: schema.member.role,
      createdAt: schema.member.createdAt,
      name: schema.user.name,
      email: schema.user.email,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .where(scoped(schema.member.organizationId, session.organizationId));
  return Response.json({
    members: members.map((member) => ({
      ...member,
      createdAt: member.createdAt.toISOString(),
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

function teamAccountDependencies(): TeamAccountDependencies {
  const db = getDb();
  const auth = getAuth();
  return {
    async findUserByEmail(email) {
      const rows = await db
        .select({ id: schema.user.id, memberId: schema.member.id })
        .from(schema.user)
        .leftJoin(schema.member, eq(schema.member.userId, schema.user.id))
        .where(eq(schema.user.email, email))
        .limit(1);
      const row = rows[0];
      return row ? { id: row.id, hasMembership: row.memberId !== null } : null;
    },
    async removeUserIfOrphan(userId) {
      const deleted = await db
        .delete(schema.user)
        .where(
          and(
            eq(schema.user.id, userId),
            sql`not exists (select 1 from ${schema.member} where ${schema.member.userId} = ${schema.user.id})`
          )
        )
        .returning({ id: schema.user.id });
      return deleted.length === 1;
    },
    async signUp(input) {
      const result = await runInternalSignup(() =>
        auth.api.signUpEmail({ body: input })
      );
      return result.user.id;
    },
    async attachMembership(organizationId, userId) {
      const inserted = await db
        .insert(schema.member)
        .values({
          id: newId("member"),
          organizationId,
          userId,
          role: "member",
        })
        .returning({ id: schema.member.id });
      return inserted.length === 1;
    },
  };
}

export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede crear cuentas");
  }
  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  try {
    await createTeamAccount(
      { ...body.data, organizationId: session.organizationId },
      teamAccountDependencies()
    );
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof TeamAccountError) {
      if (error.code === "duplicate") {
        return apiError(409, "duplicate", "Ya existe una cuenta con ese correo");
      }
      if (error.code === "membership_failed") {
        return apiError(500, "membership_failed", "No se pudo vincular la cuenta al equipo");
      }
      return apiError(422, "invalid", "No se pudo crear la cuenta");
    }
    throw error;
  }
});