import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { publish } from "@/server/events/bus";
import { scheduleAgentDispatch } from "@/server/ai/dispatch";
import { applyInboundEffects } from "@/server/inbox/inbound-effects";

export type InboundMessageInput = {
  organizationId: string;
  from: string;
  profileName: string | null;
  waMessageId: string;
  type: string;
  text: string | null;
  timestamp: string;
};

type Contact = typeof schema.contact.$inferSelect;
type Conversation = typeof schema.conversation.$inferSelect;
type Message = typeof schema.message.$inferSelect;

export async function ingestInboundMessage(
  input: InboundMessageInput
): Promise<void> {
  const db = getDb();
  const organizationId = input.organizationId;
  const waTimestamp = toDate(input.timestamp);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(schema.message)
      .where(
        and(
          eq(schema.message.organizationId, organizationId),
          eq(schema.message.waMessageId, input.waMessageId)
        )
      )
      .for("update")
      .limit(1);
    let existingMessage: Message | null = existingRows[0] ?? null;
    let contact: Contact;
    let conversation: Conversation;

    if (existingMessage) {
      const contextRows = await tx
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
            eq(schema.conversation.id, existingMessage.conversationId),
            eq(schema.conversation.organizationId, organizationId),
            eq(schema.contact.organizationId, organizationId)
          )
        )
        .limit(1);
      const context = contextRows[0];
      if (!context) throw new Error("inbound_context_missing");
      contact = context.contact;
      conversation = context.conversation;
    } else {
      const insertedContacts = await tx
        .insert(schema.contact)
        .values({
          id: newId("contact"),
          organizationId,
          phone: input.from,
          name: input.profileName?.trim() || input.from,
        })
        .onConflictDoNothing()
        .returning();
      contact = insertedContacts[0] as Contact;

      if (!contact) {
        const contactRows = await tx
          .select()
          .from(schema.contact)
          .where(
            and(
              eq(schema.contact.organizationId, organizationId),
              eq(schema.contact.phone, input.from)
            )
          )
          .limit(1);
        const found = contactRows[0];
        if (!found) throw new Error("inbound_contact_missing");
        contact = found;
        if (contact.archivedAt) {
          const reactivated = await tx
            .update(schema.contact)
            .set({ archivedAt: null, updatedAt: now })
            .where(
              and(
                eq(schema.contact.id, contact.id),
                eq(schema.contact.organizationId, organizationId)
              )
            )
            .returning();
          contact = reactivated[0] ?? { ...contact, archivedAt: null };
        }
      }

      const insertedConversations = await tx
        .insert(schema.conversation)
        .values({ id: newId("conversation"), organizationId, contactId: contact.id })
        .onConflictDoNothing()
        .returning();
      conversation = insertedConversations[0] as Conversation;

      if (!conversation) {
        const conversationRows = await tx
          .select()
          .from(schema.conversation)
          .where(
            and(
              eq(schema.conversation.organizationId, organizationId),
              eq(schema.conversation.contactId, contact.id),
              eq(schema.conversation.isTest, false)
            )
          )
          .limit(1);
        const found = conversationRows[0];
        if (!found) throw new Error("inbound_conversation_missing");
        conversation = found;
      }
    }

    const effects = await applyInboundEffects<Message>({
      async insertOrLock() {
        if (existingMessage) return existingMessage;

        const insertedMessages = await tx
          .insert(schema.message)
          .values({
            id: newId("message"),
            organizationId,
            conversationId: conversation.id,
            waMessageId: input.waMessageId,
            direction: "in",
            type: input.type,
            text: input.text,
            status: "delivered",
            waTimestamp,
          })
          .onConflictDoNothing()
          .returning();
        const inserted = insertedMessages[0];
        if (inserted) return inserted;

        const duplicateRows = await tx
          .select()
          .from(schema.message)
          .where(
            and(
              eq(schema.message.organizationId, organizationId),
              eq(schema.message.waMessageId, input.waMessageId)
            )
          )
          .for("update")
          .limit(1);
        const duplicate = duplicateRows[0];
        if (!duplicate) throw new Error("inbound_message_missing");
        if (duplicate.conversationId !== conversation.id) {
          throw new Error("inbound_identity_conflict");
        }
        existingMessage = duplicate;
        return duplicate;
      },

      async updateConversation() {
        await tx
          .update(schema.conversation)
          .set({
            lastInboundAt: waTimestamp,
            lastMessageAt: waTimestamp,
            unreadCount: sql`${schema.conversation.unreadCount} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.conversation.id, conversation.id),
              eq(schema.conversation.organizationId, organizationId)
            )
          );
      },

      async updateLead() {
        const existingLeads = await tx
          .select({ id: schema.lead.id })
          .from(schema.lead)
          .where(
            and(
              eq(schema.lead.organizationId, organizationId),
              eq(schema.lead.contactId, contact.id)
            )
          )
          .limit(1);
        const existingLead = existingLeads[0];
        if (existingLead) {
          await tx
            .update(schema.lead)
            .set({ lastActivityAt: waTimestamp, updatedAt: now })
            .where(
              and(
                eq(schema.lead.id, existingLead.id),
                eq(schema.lead.organizationId, organizationId)
              )
            );
          return;
        }

        const firstStages = await tx
          .select({ id: schema.pipelineStage.id })
          .from(schema.pipelineStage)
          .where(
            and(
              eq(schema.pipelineStage.organizationId, organizationId),
              eq(schema.pipelineStage.kind, "open")
            )
          )
          .orderBy(asc(schema.pipelineStage.position))
          .limit(1);
        const firstStage = firstStages[0];
        if (!firstStage) return;

        const maxPositions = await tx
          .select({
            max: sql<number>`coalesce(max(${schema.lead.position}), -1)`,
          })
          .from(schema.lead)
          .where(
            and(
              eq(schema.lead.organizationId, organizationId),
              eq(schema.lead.stageId, firstStage.id)
            )
          );
        await tx
          .insert(schema.lead)
          .values({
            id: newId("lead"),
            organizationId,
            contactId: contact.id,
            stageId: firstStage.id,
            position: (maxPositions[0]?.max ?? -1) + 1,
            lastActivityAt: waTimestamp,
          })
          .onConflictDoUpdate({
            target: schema.lead.contactId,
            set: { lastActivityAt: waTimestamp, updatedAt: now },
          });
      },

      async createDispatch(message) {
        await tx
          .insert(schema.agentDispatch)
          .values({
            id: newId("agentDispatch"),
            organizationId,
            conversationId: conversation.id,
            sourceMessageId: message.id,
            availableAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing();
      },

      async markProcessed(message) {
        const processed = await tx
          .update(schema.message)
          .set({ processedAt: now })
          .where(
            and(
              eq(schema.message.id, message.id),
              eq(schema.message.organizationId, organizationId),
              isNull(schema.message.processedAt)
            )
          )
          .returning();
        const updated = processed[0];
        if (!updated) throw new Error("inbound_processed_race");
        return updated;
      },
    });

    return { ...effects, contact, conversation };
  });

  if (!result.applied) return;
  publishAfterCommit(organizationId, {
    type: "message.new",
    data: {
      conversationId: result.conversation.id,
      message: serializeMessage(result.message),
    },
  });
  publishAfterCommit(organizationId, {
    type: "conversation.updated",
    data: { conversation: { id: result.conversation.id } },
  });

  try {
    scheduleAgentDispatch(result.conversation.id);
  } catch {
    console.error("[inbound] agent_wakeup_failed");
  }
}

function publishAfterCommit(
  organizationId: string,
  event: Parameters<typeof publish>[1]
): void {
  try {
    publish(organizationId, event);
  } catch {
    console.error("[inbound] sse_publish_failed");
  }
}

function toDate(timestamp: string): Date {
  const value = Number(timestamp);
  if (Number.isFinite(value) && value > 0) return new Date(value * 1000);
  return new Date();
}

export function serializeMessage(message: typeof schema.message.$inferSelect) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    direction: message.direction,
    type: message.type,
    text: message.text,
    status:
      message.deliveryState === "failed" && message.status === "pending"
        ? "failed"
        : message.status,
    aiGenerated: message.aiGenerated,
    createdAt: (message.waTimestamp ?? message.createdAt).toISOString(),
  };
}