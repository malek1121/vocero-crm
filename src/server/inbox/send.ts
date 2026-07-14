import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { ChannelError, sendChannelText } from "@/server/baileys/manager";
import { serializeMessage } from "@/server/inbox/ingest";
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BATCH_SIZE,
  drainRecoveryPages,
} from "@/server/inbox/recovery";
import {
  SendError,
  createOutboundDelivery,
  type DeliveryState,
  type OutboundIntent,
  type OutboundStore,
} from "@/server/inbox/outbound";

export { SendError } from "@/server/inbox/outbound";


type MessageRow = typeof schema.message.$inferSelect;

function newWhatsAppMessageId(): string {
  return randomBytes(16).toString("hex").toUpperCase();
}

function isDeliveryState(value: string | null): value is DeliveryState {
  return (
    value === "pending" ||
    value === "sending" ||
    value === "sent" ||
    value === "failed"
  );
}

function toIntent(message: MessageRow, phone: string): OutboundIntent | null {
  if (
    message.direction !== "out" ||
    message.text === null ||
    message.idempotencyKey === null ||
    message.waMessageId === null ||
    !isDeliveryState(message.deliveryState)
  ) {
    return null;
  }

  return {
    id: message.id,
    organizationId: message.organizationId,
    conversationId: message.conversationId,
    phone,
    text: message.text,
    aiGenerated: message.aiGenerated,
    idempotencyKey: message.idempotencyKey,
    waMessageId: message.waMessageId,
    deliveryState: message.deliveryState,
  };
}

async function findIntentById(id: string): Promise<OutboundIntent | null> {
  const db = getDb();
  const rows = await db
    .select({ message: schema.message, phone: schema.contact.phone })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(eq(schema.message.id, id))
    .limit(1);
  const row = rows[0];
  return row ? toIntent(row.message, row.phone) : null;
}

async function findIntentByKey(
  organizationId: string,
  idempotencyKey: string
): Promise<OutboundIntent | null> {
  const db = getDb();
  const rows = await db
    .select({ message: schema.message, phone: schema.contact.phone })
    .from(schema.message)
    .innerJoin(
      schema.conversation,
      eq(schema.message.conversationId, schema.conversation.id)
    )
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  const row = rows[0];
  return row ? toIntent(row.message, row.phone) : null;
}

function safePublish(
  organizationId: string,
  event: Parameters<typeof publish>[1]
): void {
  try {
    publish(organizationId, event);
  } catch {
    console.error("[outbound] sse_publish_failed");
  }
}

const outboundStore: OutboundStore = {
  async getOrCreate(input) {
    const db = getDb();
    const messageId = newId("message");
    const waMessageId = newWhatsAppMessageId();
    const createdAt = new Date();

    const inserted = await db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.message)
        .values({
          id: messageId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          waMessageId,
          idempotencyKey: input.idempotencyKey,
          deliveryState: "pending",
          direction: "out",
          type: "text",
          text: input.text,
          status: "pending",
          aiGenerated: input.aiGenerated,
          createdAt,
        })
        .onConflictDoNothing()
        .returning();
      const message = rows[0];
      if (!message) return null;

      await tx
        .update(schema.conversation)
        .set({ lastMessageAt: createdAt, updatedAt: createdAt })
        .where(
          and(
            eq(schema.conversation.id, input.conversationId),
            eq(schema.conversation.organizationId, input.organizationId)
          )
        );
      return message;
    });

    if (inserted) {
      const intent = toIntent(inserted, input.phone);
      if (!intent) throw new SendError("send_failed");
      safePublish(input.organizationId, {
        type: "message.new",
        data: {
          conversationId: input.conversationId,
          message: serializeMessage(inserted),
        },
      });
      safePublish(input.organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: input.conversationId } },
      });
      return { intent, created: true, conflict: false };
    }

    const existing = await findIntentByKey(
      input.organizationId,
      input.idempotencyKey
    );
    if (!existing) throw new SendError("send_failed");
    const conflict =
      existing.conversationId !== input.conversationId ||
      existing.text !== input.text ||
      existing.aiGenerated !== input.aiGenerated;
    return { intent: existing, created: false, conflict };
  },

  getById: findIntentById,

  async claim(id, now, leaseUntil) {
    const db = getDb();
    const updated = await db
      .update(schema.message)
      .set({
        deliveryState: "sending",
        deliveryAttempts: sql`${schema.message.deliveryAttempts} + 1`,
        deliveryLeaseUntil: leaseUntil,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(schema.message.id, id),
          or(
            eq(schema.message.deliveryState, "pending"),
            eq(schema.message.deliveryState, "failed"),
            and(
              eq(schema.message.deliveryState, "sending"),
              or(
                isNull(schema.message.deliveryLeaseUntil),
                lt(schema.message.deliveryLeaseUntil, now)
              )
            )
          )
        )
      )
      .returning({ id: schema.message.id });
    return updated[0] ? findIntentById(updated[0].id) : null;
  },

  async markSent(id) {
    const db = getDb();
    await db
      .update(schema.message)
      .set({
        deliveryState: "sent",
        deliveryLeaseUntil: null,
        lastErrorCode: null,
      })
      .where(eq(schema.message.id, id));
  },

  async markFailed(id, code) {
    const db = getDb();
    const rows = await db
      .update(schema.message)
      .set({
        deliveryState: "failed",
        deliveryLeaseUntil: null,
        lastErrorCode: code,
      })
      .where(eq(schema.message.id, id))
      .returning({
        organizationId: schema.message.organizationId,
        conversationId: schema.message.conversationId,
      });
    const message = rows[0];
    if (message) {
      safePublish(message.organizationId, {
        type: "message.status",
        data: {
          conversationId: message.conversationId,
          messageId: id,
          status: "failed",
        },
      });
    }
  },
};

const outboundDelivery = createOutboundDelivery({
  store: outboundStore,
  async deliver(input) {
    try {
      return await sendChannelText(
        input.organizationId,
        input.phone,
        input.text,
        input.waMessageId
      );
    } catch (error) {
      if (error instanceof ChannelError && error.code === "not_connected") {
        throw new SendError("not_connected");
      }
      throw new SendError("send_failed");
    }
  },
});

export type SendResult = Awaited<
  ReturnType<(typeof outboundDelivery)["submit"]>
>;

export type SendTextInput = {
  organizationId: string;
  conversationId: string;
  text: string;
  idempotencyKey: string;
  aiGenerated?: boolean;
};

/** Persiste la intención antes de tocar WhatsApp y reutiliza ambos IDs. */
export async function sendText(input: SendTextInput): Promise<SendResult> {
  const db = getDb();
  const rows = await db
    .select({
      conversation: schema.conversation,
      contact: schema.contact,
    })
    .from(schema.conversation)
    .innerJoin(
      schema.contact,
      eq(schema.conversation.contactId, schema.contact.id)
    )
    .where(
      and(
        eq(schema.conversation.id, input.conversationId),
        eq(schema.conversation.organizationId, input.organizationId),
        eq(schema.contact.organizationId, input.organizationId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new SendError("send_failed");
  if (row.conversation.isTest) throw new SendError("sandbox_violation");

  return outboundDelivery.submit({
    ...input,
    phone: row.contact.phone,
    aiGenerated: input.aiGenerated ?? false,
  });
}

/** Reintenta el conjunto elegible al abrir el canal, en páginas estables. */
export async function resumeOutboundMessages(
  organizationId: string
): Promise<void> {
  const db = getDb();
  const recoveryStartedAt = new Date();

  // Channel-ready means the previous socket cannot still own an in-flight send.
  await db
    .update(schema.message)
    .set({ deliveryLeaseUntil: null })
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.deliveryState, "sending")
      )
    );

  await drainRecoveryPages({
    loadPage: (cursor) =>
      db
        .select({
          id: schema.message.id,
          createdAt: schema.message.createdAt,
          conversationId: schema.message.conversationId,
          text: schema.message.text,
          aiGenerated: schema.message.aiGenerated,
          idempotencyKey: schema.message.idempotencyKey,
        })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.organizationId, organizationId),
            eq(schema.message.direction, "out"),
            isNotNull(schema.message.idempotencyKey),
            lt(schema.message.deliveryAttempts, MAX_RECOVERY_ATTEMPTS),
            lte(schema.message.createdAt, recoveryStartedAt),
            or(
              eq(schema.message.deliveryState, "pending"),
              eq(schema.message.deliveryState, "failed"),
              eq(schema.message.deliveryState, "sending")
            ),
            cursor
              ? or(
                  gt(schema.message.createdAt, cursor.createdAt),
                  and(
                    eq(schema.message.createdAt, cursor.createdAt),
                    gt(schema.message.id, cursor.id)
                  )
                )
              : undefined
          )
        )
        .orderBy(asc(schema.message.createdAt), asc(schema.message.id))
        .limit(RECOVERY_BATCH_SIZE),
    async deliver(row) {
      if (row.text === null || row.idempotencyKey === null) return;
      await sendText({
        organizationId,
        conversationId: row.conversationId,
        text: row.text,
        aiGenerated: row.aiGenerated,
        idempotencyKey: row.idempotencyKey,
      });
    },
    onDeliveryError() {
      console.error("[outbound] recovery_delivery_failed");
    },
  });
}
