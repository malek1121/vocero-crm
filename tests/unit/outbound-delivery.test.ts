import { describe, expect, it, vi } from "vitest";
import {
  SendError,
  createOutboundDelivery,
  type OutboundIntent,
  type OutboundStore,
} from "@/server/inbox/outbound";

const intent: OutboundIntent = {
  id: "msg_1",
  organizationId: "org_1",
  conversationId: "cv_1",
  phone: "51987654321",
  text: "Hola",
  aiGenerated: false,
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  waMessageId: "AABBCCDDEEFF00112233445566778899",
  deliveryState: "pending",
};

const input = {
  organizationId: intent.organizationId,
  conversationId: intent.conversationId,
  phone: intent.phone,
  text: intent.text,
  aiGenerated: intent.aiGenerated,
  idempotencyKey: intent.idempotencyKey,
};

function fakeStore(overrides: Partial<OutboundStore> = {}): OutboundStore {
  return {
    getOrCreate: vi.fn().mockResolvedValue({
      intent,
      created: true,
      conflict: false,
    }),
    getById: vi.fn().mockResolvedValue(intent),
    claim: vi.fn().mockResolvedValue({ ...intent, deliveryState: "sending" }),
    markSent: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("outbound delivery", () => {
  it("returns an already-sent intent without delivering twice", async () => {
    const sent = { ...intent, deliveryState: "sent" as const };
    const store = fakeStore({
      getOrCreate: vi.fn().mockResolvedValue({
        intent: sent,
        created: false,
        conflict: false,
      }),
    });
    const deliver = vi.fn();

    const result = await createOutboundDelivery({ store, deliver }).submit(input);

    expect(result).toEqual({
      messageId: intent.id,
      waMessageId: intent.waMessageId,
      deliveryState: "sent",
      created: false,
    });
    expect(deliver).not.toHaveBeenCalled();
  });

  it("rejects reuse of a key with different immutable content", async () => {
    const store = fakeStore({
      getOrCreate: vi.fn().mockResolvedValue({
        intent,
        created: false,
        conflict: true,
      }),
    });

    await expect(
      createOutboundDelivery({ store, deliver: vi.fn() }).submit({
        ...input,
        text: "Otro texto",
      })
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("lets only the atomic claimant call WhatsApp", async () => {
    const sending = { ...intent, deliveryState: "sending" as const };
    const store = fakeStore({
      getOrCreate: vi.fn().mockResolvedValue({
        intent,
        created: false,
        conflict: false,
      }),
      claim: vi.fn().mockResolvedValue(null),
      getById: vi.fn().mockResolvedValue(sending),
    });
    const deliver = vi.fn();

    const result = await createOutboundDelivery({ store, deliver }).submit(input);

    expect(result.deliveryState).toBe("sending");
    expect(deliver).not.toHaveBeenCalled();
  });

  it("claims an expired lease and reuses the stable WhatsApp ID", async () => {
    const store = fakeStore({
      getOrCreate: vi.fn().mockResolvedValue({
        intent: { ...intent, deliveryState: "sending" },
        created: false,
        conflict: false,
      }),
    });
    const deliver = vi.fn().mockResolvedValue(intent.waMessageId);
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = await createOutboundDelivery({
      store,
      deliver,
      now: () => now,
      leaseMs: 30_000,
    }).submit(input);

    expect(store.claim).toHaveBeenCalledWith(
      intent.id,
      now,
      new Date("2026-01-01T00:00:30.000Z")
    );
    expect(deliver).toHaveBeenCalledWith({
      organizationId: intent.organizationId,
      phone: intent.phone,
      text: intent.text,
      waMessageId: intent.waMessageId,
    });
    expect(result.deliveryState).toBe("sent");
  });

  it("leaves an accepted send leased when the sent write is ambiguous", async () => {
    const store = fakeStore({
      markSent: vi.fn().mockRejectedValue(new Error("database unavailable")),
    });
    const deliver = vi.fn().mockResolvedValue(intent.waMessageId);

    await expect(
      createOutboundDelivery({ store, deliver }).submit(input)
    ).rejects.toMatchObject({
      code: "send_failed",
      intent: {
        messageId: intent.id,
        waMessageId: intent.waMessageId,
      },
    });
    expect(store.markFailed).not.toHaveBeenCalled();
  });

  it("fails safely when WhatsApp returns a different message ID", async () => {
    const store = fakeStore();

    await expect(
      createOutboundDelivery({
        store,
        deliver: vi.fn().mockResolvedValue("DIFFERENT"),
      }).submit(input)
    ).rejects.toMatchObject({ code: "send_failed" });
    expect(store.markFailed).toHaveBeenCalledWith(
      intent.id,
      "provider_id_mismatch"
    );
  });

  it("persists only a stable failure code", async () => {
    const store = fakeStore();
    const raw = new Error("provider body with customer data");

    await expect(
      createOutboundDelivery({
        store,
        deliver: vi
          .fn()
          .mockRejectedValue(new SendError("not_connected", raw.message)),
      }).submit(input)
    ).rejects.toMatchObject({ code: "not_connected" });
    expect(store.markFailed).toHaveBeenCalledWith(intent.id, "not_connected");
  });
});