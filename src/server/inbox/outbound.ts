export type DeliveryState = "pending" | "sending" | "sent" | "failed";
export type DeliveryErrorCode =
  | "not_connected"
  | "send_failed"
  | "provider_id_mismatch";

export type OutboundIntent = {
  id: string;
  organizationId: string;
  conversationId: string;
  phone: string;
  text: string;
  aiGenerated: boolean;
  idempotencyKey: string;
  waMessageId: string;
  deliveryState: DeliveryState;
};

export type OutboundInput = Omit<
  OutboundIntent,
  "id" | "waMessageId" | "deliveryState"
>;

export type OutboundStore = {
  getOrCreate(input: OutboundInput): Promise<{
    intent: OutboundIntent;
    created: boolean;
    conflict: boolean;
  }>;
  getById(id: string): Promise<OutboundIntent | null>;
  claim(
    id: string,
    now: Date,
    leaseUntil: Date
  ): Promise<OutboundIntent | null>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, code: DeliveryErrorCode): Promise<void>;
};

export type DeliverOutbound = (input: {
  organizationId: string;
  phone: string;
  text: string;
  waMessageId: string;
}) => Promise<string>;

export type SendErrorCode =
  | "sandbox_violation"
  | "not_connected"
  | "send_failed"
  | "idempotency_conflict";

const SAFE_ERROR_MESSAGES: Record<SendErrorCode, string> = {
  sandbox_violation:
    "La conversación de prueba no puede enviar mensajes reales",
  not_connected: "WhatsApp no está conectado",
  send_failed: "No se pudo enviar el mensaje por WhatsApp",
  idempotency_conflict:
    "La clave de idempotencia ya fue usada con otro mensaje",
};

export type DurableIntentRef = {
  messageId: string;
  waMessageId: string;
};

export class SendError extends Error {
  readonly code: SendErrorCode;
  readonly intent: DurableIntentRef | null;

  constructor(
    code: SendErrorCode,
    _unsafeDetail?: unknown,
    intent: DurableIntentRef | null = null
  ) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "SendError";
    this.code = code;
    this.intent = intent;
  }
}

export type OutboundResult = {
  messageId: string;
  waMessageId: string;
  deliveryState: DeliveryState;
  created: boolean;
};

const DEFAULT_LEASE_MS = 30_000;

export function createOutboundDelivery(dependencies: {
  store: OutboundStore;
  deliver: DeliverOutbound;
  now?: () => Date;
  leaseMs?: number;
}): { submit(input: OutboundInput): Promise<OutboundResult> } {
  const {
    store,
    deliver,
    now = () => new Date(),
    leaseMs = DEFAULT_LEASE_MS,
  } = dependencies;

  return {
    async submit(input) {
      const found = await store.getOrCreate(input);
      if (found.conflict) {
        throw new SendError(
          "idempotency_conflict",
          undefined,
          toIntentRef(found.intent)
        );
      }

      if (found.intent.deliveryState === "sent") {
        return toResult(found.intent, found.created);
      }

      const claimedAt = now();
      const leaseUntil = new Date(claimedAt.getTime() + leaseMs);
      const claimed = await store.claim(
        found.intent.id,
        claimedAt,
        leaseUntil
      );
      if (!claimed) {
        const current = (await store.getById(found.intent.id)) ?? found.intent;
        return toResult(current, found.created);
      }

      let returnedMessageId: string;
      try {
        returnedMessageId = await deliver({
          organizationId: claimed.organizationId,
          phone: claimed.phone,
          text: claimed.text,
          waMessageId: claimed.waMessageId,
        });
      } catch (error) {
        const safeCode: DeliveryErrorCode =
          error instanceof SendError && error.code === "not_connected"
            ? "not_connected"
            : "send_failed";
        await store.markFailed(claimed.id, safeCode);
        throw new SendError(safeCode, undefined, toIntentRef(claimed));
      }

      if (returnedMessageId !== claimed.waMessageId) {
        await store.markFailed(claimed.id, "provider_id_mismatch");
        throw new SendError("send_failed", undefined, toIntentRef(claimed));
      }

      // A failure here is ambiguous: keep the lease so recovery retries later
      // with the same application and WhatsApp identifiers.
      try {
        await store.markSent(claimed.id);
      } catch {
        throw new SendError("send_failed", undefined, toIntentRef(claimed));
      }
      return toResult(
        { ...claimed, deliveryState: "sent" },
        found.created
      );
    },
  };
}

function toResult(intent: OutboundIntent, created: boolean): OutboundResult {
  return {
    messageId: intent.id,
    waMessageId: intent.waMessageId,
    deliveryState: intent.deliveryState,
    created,
  };
}
function toIntentRef(intent: OutboundIntent): DurableIntentRef {
  return { messageId: intent.id, waMessageId: intent.waMessageId };
}