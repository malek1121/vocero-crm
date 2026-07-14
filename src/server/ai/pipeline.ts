import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isAiConfigured } from "@/lib/env";
import { chatJson, throwIfAborted, type ChatMessage } from "@/lib/ai";
import { publish } from "@/server/events/bus";
import { SendError, sendText } from "@/server/inbox/send";
import { AgentAction, degradeAction, resolveStage, type AgentActionType } from "@/server/ai/actions";
import { matchesHandoffIntent } from "@/server/ai/handoff";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";

/**
 * Ejecuta UN turno del agente ahora (el Laboratorio lo llama directo, con
 * debounce 0 y sin pasar por el coalesce).
 */
export async function runAgentTurn(
  conversationId: string,
  options: { replyIdempotencyKey?: string; signal?: AbortSignal } = {}
): Promise<void> {
  throwIfAborted(options.signal);
  if (!isAiConfigured()) return;

  const db = getDb();
  const convRows = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.id, conversationId))
    .limit(1);
  const conversation = convRows[0];
  if (!conversation) return;
  const organizationId = conversation.organizationId;

  // Condiciones de silencio: handoff activo o IA apagada en la conversación.
  if (conversation.handoffAt || !conversation.aiEnabled) return;

  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return;
  // El toggle global aplica a conversaciones reales; el Laboratorio evalúa el
  // comportamiento configurado aunque el agente aún no esté encendido.
  if (!conversation.isTest && !profile.enabled) return;

  const history = await db
    .select()
    .from(schema.message)
    .where(eq(schema.message.conversationId, conversationId))
    .orderBy(desc(schema.message.createdAt))
    .limit(20);
  history.reverse();
  const lastInbound = [...history].reverse().find((m) => m.direction === "in");
  if (!lastInbound) return;
  const replyIdempotencyKey =
    options.replyIdempotencyKey ?? "agent:" + lastInbound.id;

  // Baileys no tiene ventana de 24h (spec 002 FR-B06): sin handoff 'ventana'.

  // Patrón de respaldo ANTES del LLM (FR-022).
  if (lastInbound.text && matchesHandoffIntent(lastInbound.text)) {
    await applyHandoff(conversationId, organizationId, "cliente");
    return;
  }

  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId))
    .orderBy(asc(schema.kbEntry.createdAt));
  const stages = await db
    .select({ id: schema.pipelineStage.id, name: schema.pipelineStage.name })
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildAgentSystemPrompt({ profile, kb, stages }),
    },
    ...history
      .filter((m) => m.text)
      .map((m) => ({
        role: m.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: m.text!,
      })),
  ];

  throwIfAborted(options.signal);
  const result = await chatJson(AgentAction, messages, {
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (!result.ok) {
    if (result.error === "not_configured") return;
    // Fallo persistente del proveedor o salida imposible → escalar (FR-022).
    console.error(`[agent] provider_failed code=${result.error}`);
    await applyHandoff(conversationId, organizationId, "error");
    return;
  }

  let action: AgentActionType = result.data;

  if (action.action === "move_stage") {
    const stage = resolveStage(action.stage, stages);
    if (!stage) {
      action = degradeAction(action);
    } else {
      await moveLeadToStage(organizationId, conversation.contactId, stage.id);
      publish(organizationId, {
        type: "conversation.updated",
        data: { conversation: { id: conversationId } },
      });
      if (action.reply) {
        await deliverReply(conversation, action.reply, replyIdempotencyKey);
      }
      return;
    }
  }

  switch (action.action) {
    case "none":
      return;
    case "reply":
      await deliverReply(conversation, action.text, replyIdempotencyKey);
      return;
    case "update_lead": {
      await appendLeadNote(organizationId, conversation.contactId, action.note);
      if (action.reply) await deliverReply(conversation, action.reply, replyIdempotencyKey);
      return;
    }
    case "handoff": {
      if (action.farewell) {
        await deliverReply(conversation, action.farewell, replyIdempotencyKey);
      }
      await applyHandoff(conversationId, organizationId, "modelo");
      return;
    }
  }
}

type Conversation = typeof schema.conversation.$inferSelect;

/** Entrega la respuesta: envío real o persistencia sandbox (is_test). */
async function deliverReply(
  conversation: Conversation,
  text: string,
  idempotencyKey: string
): Promise<void> {
  if (conversation.isTest) {
    await persistTestOutbound(conversation, text);
    return;
  }
  // "Escribiendo…" hacia el contacto mientras se entrega (spec 004 FR-412).
  const phone = await contactPhone(conversation);
  const { sendChannelTyping } = await import("@/server/baileys/manager");
  if (phone) await sendChannelTyping(conversation.organizationId, phone, "composing");
  try {
    await sendText({
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      text,
      aiGenerated: true,
      idempotencyKey,
    });
  } catch (error) {
    // The dispatcher owns the decision, not provider delivery. A durable intent
    // is enough to complete the dispatch; channel recovery owns later retries.
    if (error instanceof SendError && error.intent) return;
    throw error;
  } finally {
    if (phone) await sendChannelTyping(conversation.organizationId, phone, "paused");
  }
}

async function contactPhone(conversation: Conversation): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select({ phone: schema.contact.phone })
    .from(schema.contact)
    .where(
      and(
        eq(schema.contact.id, conversation.contactId),
        eq(schema.contact.organizationId, conversation.organizationId)
      )
    )
    .limit(1);
  return rows[0]?.phone ?? null;
}

/** Mensaje saliente del sandbox: se persiste, JAMÁS toca la API (FR-031). */
async function persistTestOutbound(
  conversation: Conversation,
  text: string
): Promise<void> {
  const db = getDb();
  await db.insert(schema.message).values({
    id: newId("message"),
    organizationId: conversation.organizationId,
    conversationId: conversation.id,
    direction: "out",
    type: "text",
    text,
    status: "sent",
    aiGenerated: true,
  });
  await db
    .update(schema.conversation)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversation.id));
}

export async function applyHandoff(
  conversationId: string,
  organizationId: string,
  reason: "cliente" | "modelo" | "error" | "ventana"
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(schema.conversation)
    .set({ handoffAt: new Date(), handoffReason: reason, updatedAt: new Date() })
    .where(eq(schema.conversation.id, conversationId))
    .returning();
  if (!updated[0]) return;
  publish(organizationId, {
    type: "conversation.updated",
    data: {
      conversation: { id: conversationId, handoffReason: reason },
    },
  });
}

async function moveLeadToStage(
  organizationId: string,
  contactId: string,
  stageId: string
): Promise<void> {
  const db = getDb();
  await db
    .update(schema.lead)
    .set({ stageId, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(schema.lead.contactId, contactId));
}

async function appendLeadNote(
  organizationId: string,
  contactId: string,
  note: string
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.contact.id, notes: schema.contact.notes })
    .from(schema.contact)
    .where(eq(schema.contact.id, contactId))
    .limit(1);
  const contact = rows[0];
  if (!contact) return;
  const stamped = `[IA] ${note}`;
  await db
    .update(schema.contact)
    .set({
      notes: contact.notes ? `${contact.notes}\n${stamped}` : stamped,
      updatedAt: new Date(),
    })
    .where(eq(schema.contact.id, contact.id));
}
