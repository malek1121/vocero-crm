import { and, eq, inArray } from "drizzle-orm";
import { BufferJSON, initAuthCreds, proto } from "baileys";
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataTypeMap,
} from "baileys";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

/**
 * Auth state de Baileys respaldado en Postgres, cifrado AES-256-GCM
 * (Constitución I / spec 002 FR-B02). Cada fila es un par (org, key):
 * "creds" o "<tipo>:<id>" de las signal keys.
 */

async function readValue(
  organizationId: string,
  key: string
): Promise<unknown | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.baileysAuth)
    .where(
      and(
        eq(schema.baileysAuth.organizationId, organizationId),
        eq(schema.baileysAuth.key, key)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const plain = decryptSecret({
    cipher: row.valueCipher,
    iv: row.valueIv,
    tag: row.valueTag,
  });
  return JSON.parse(plain, BufferJSON.reviver);
}

async function writeValue(
  organizationId: string,
  key: string,
  value: unknown
): Promise<void> {
  const db = getDb();
  const enc = encryptSecret(JSON.stringify(value, BufferJSON.replacer));
  await db
    .insert(schema.baileysAuth)
    .values({
      id: newId("baileysAuth"),
      organizationId,
      key,
      valueCipher: enc.cipher,
      valueIv: enc.iv,
      valueTag: enc.tag,
    })
    .onConflictDoUpdate({
      target: [schema.baileysAuth.organizationId, schema.baileysAuth.key],
      set: {
        valueCipher: enc.cipher,
        valueIv: enc.iv,
        valueTag: enc.tag,
        updatedAt: new Date(),
      },
    });
}

async function deleteValue(
  organizationId: string,
  key: string
): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.baileysAuth)
    .where(
      and(
        eq(schema.baileysAuth.organizationId, organizationId),
        eq(schema.baileysAuth.key, key)
      )
    );
}

/** Borra toda la sesión guardada (logout / logout remoto). */
export async function clearAuthState(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.baileysAuth)
    .where(eq(schema.baileysAuth.organizationId, organizationId));
}

/** true si hay credenciales guardadas (para reanudar al boot). */
export async function hasStoredSession(
  organizationId: string
): Promise<boolean> {
  return (await readValue(organizationId, "creds")) !== null;
}

/** Organizaciones con sesión guardada (boot resume). */
export async function listStoredSessionOrgs(): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ organizationId: schema.baileysAuth.organizationId })
    .from(schema.baileysAuth)
    .where(eq(schema.baileysAuth.key, "creds"));
  return rows.map((r) => r.organizationId);
}

export async function loadDbAuthState(organizationId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const creds =
    ((await readValue(organizationId, "creds")) as AuthenticationCreds | null) ??
    initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[]
      ) => {
        const db = getDb();
        const keys = ids.map((id) => `${type}:${id}`);
        const rows = keys.length
          ? await db
              .select()
              .from(schema.baileysAuth)
              .where(
                and(
                  eq(schema.baileysAuth.organizationId, organizationId),
                  inArray(schema.baileysAuth.key, keys)
                )
              )
          : [];
        const out: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const row of rows) {
          const id = row.key.slice(String(type).length + 1);
          let value = JSON.parse(
            decryptSecret({
              cipher: row.valueCipher,
              iv: row.valueIv,
              tag: row.valueTag,
            }),
            BufferJSON.reviver
          );
          if (type === "app-state-sync-key" && value) {
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          out[id] = value as SignalDataTypeMap[T];
        }
        return out;
      },
      set: async (data) => {
        for (const [type, byId] of Object.entries(data)) {
          for (const [id, value] of Object.entries(byId ?? {})) {
            const key = `${type}:${id}`;
            if (value === null || value === undefined) {
              await deleteValue(organizationId, key);
            } else {
              await writeValue(organizationId, key, value);
            }
          }
        }
      },
    },
  };

  return {
    state,
    saveCreds: () => writeValue(organizationId, "creds", state.creds),
  };
}
