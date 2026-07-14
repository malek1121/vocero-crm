import { describe, expect, it, vi } from "vitest";
import { createAgentDispatchRunner } from "@/server/ai/dispatch-runner";

const dispatch = {
  id: "dispatch_1",
  conversationId: "cv_1",
};

describe("durable agent dispatch runner", () => {
  it("does nothing when another worker owns the lease", async () => {
    const store = {
      claim: vi.fn().mockResolvedValue(null),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const runTurn = vi.fn();

    const result = await createAgentDispatchRunner({
      store,
      runTurn,
    }).execute(dispatch.conversationId);

    expect(result).toBe("idle");
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("uses a deterministic reply key and completes coalesced work", async () => {
    const store = {
      claim: vi.fn().mockResolvedValue(dispatch),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn(),
    };
    const runTurn = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = await createAgentDispatchRunner({
      store,
      runTurn,
      now: () => now,
      leaseMs: 60_000,
    }).execute(dispatch.conversationId);

    expect(store.claim).toHaveBeenCalledWith(
      dispatch.conversationId,
      now,
      new Date("2026-01-01T00:01:00.000Z")
    );
    expect(runTurn).toHaveBeenCalledWith(dispatch.conversationId, {
      replyIdempotencyKey: "agent:dispatch_1",
    });
    expect(store.complete).toHaveBeenCalledWith(
      dispatch.id,
      dispatch.conversationId,
      now
    );
    expect(result).toBe("completed");
  });

  it("persists a safe retry without raw model errors", async () => {
    const store = {
      claim: vi.fn().mockResolvedValue(dispatch),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const runTurn = vi.fn().mockRejectedValue(new Error("raw customer prompt"));
    const now = new Date("2026-01-01T00:00:00.000Z");

    const result = await createAgentDispatchRunner({
      store,
      runTurn,
      now: () => now,
      retryMs: 5_000,
    }).execute(dispatch.conversationId);

    expect(store.fail).toHaveBeenCalledWith(
      dispatch.id,
      "agent_turn_failed",
      new Date("2026-01-01T00:00:05.000Z")
    );
    expect(result).toBe("retry");
  });
});