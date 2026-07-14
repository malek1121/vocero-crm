import { describe, expect, it, vi } from "vitest";
import { applyInboundEffects } from "@/server/inbox/inbound-effects";

type Message = { id: string; processedAt: Date | null };

function steps(message: Message) {
  return {
    insertOrLock: vi.fn().mockResolvedValue(message),
    updateConversation: vi.fn().mockResolvedValue(undefined),
    updateLead: vi.fn().mockResolvedValue(undefined),
    createDispatch: vi.fn().mockResolvedValue(undefined),
    markProcessed: vi
      .fn()
      .mockResolvedValue({ ...message, processedAt: new Date(0) }),
  };
}

describe("atomic inbound effects", () => {
  it("skips every durable effect for a processed replay", async () => {
    const fns = steps({ id: "msg_1", processedAt: new Date(0) });

    const result = await applyInboundEffects(fns);

    expect(result.applied).toBe(false);
    expect(fns.updateConversation).not.toHaveBeenCalled();
    expect(fns.updateLead).not.toHaveBeenCalled();
    expect(fns.createDispatch).not.toHaveBeenCalled();
    expect(fns.markProcessed).not.toHaveBeenCalled();
  });

  it.each([
    "updateConversation",
    "updateLead",
    "createDispatch",
    "markProcessed",
  ] as const)("stops at a failed %s step", async (failedStep) => {
    const fns = steps({ id: "msg_1", processedAt: null });
    fns[failedStep].mockRejectedValue(new Error(`failed:${failedStep}`));

    await expect(applyInboundEffects(fns)).rejects.toThrow(
      `failed:${failedStep}`
    );

    const order = [
      fns.updateConversation,
      fns.updateLead,
      fns.createDispatch,
      fns.markProcessed,
    ];
    const failedIndex = [
      "updateConversation",
      "updateLead",
      "createDispatch",
      "markProcessed",
    ].indexOf(failedStep);
    for (const later of order.slice(failedIndex + 1)) {
      expect(later).not.toHaveBeenCalled();
    }
  });

  it("applies each effect once and marks the message last", async () => {
    const fns = steps({ id: "msg_1", processedAt: null });

    const result = await applyInboundEffects(fns);

    expect(result.applied).toBe(true);
    expect(result.message.processedAt).toEqual(new Date(0));
    expect(fns.updateConversation).toHaveBeenCalledOnce();
    expect(fns.updateLead).toHaveBeenCalledOnce();
    expect(fns.createDispatch).toHaveBeenCalledOnce();
    expect(fns.markProcessed).toHaveBeenCalledOnce();
    expect(fns.markProcessed.mock.invocationCallOrder[0]).toBeGreaterThan(
      fns.createDispatch.mock.invocationCallOrder[0]!
    );
  });
});