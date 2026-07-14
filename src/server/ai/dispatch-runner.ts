export type AgentDispatchLease = {
  id: string;
  conversationId: string;
};

export type AgentDispatchStore = {
  claim(
    conversationId: string,
    now: Date,
    leaseUntil: Date
  ): Promise<AgentDispatchLease | null>;
  complete(
    dispatchId: string,
    conversationId: string,
    coalesceThrough: Date
  ): Promise<void>;
  fail(
    dispatchId: string,
    code: "agent_turn_failed",
    availableAt: Date
  ): Promise<void>;
};

export type RunAgentTurn = (
  conversationId: string,
  options: { replyIdempotencyKey: string }
) => Promise<void>;

export function createAgentDispatchRunner(dependencies: {
  store: AgentDispatchStore;
  runTurn: RunAgentTurn;
  now?: () => Date;
  leaseMs?: number;
  retryMs?: number;
}): {
  execute(conversationId: string): Promise<"idle" | "completed" | "retry">;
} {
  const {
    store,
    runTurn,
    now = () => new Date(),
    leaseMs = 60_000,
    retryMs = 5_000,
  } = dependencies;

  return {
    async execute(conversationId) {
      const startedAt = now();
      const leaseUntil = new Date(startedAt.getTime() + leaseMs);
      const dispatch = await store.claim(
        conversationId,
        startedAt,
        leaseUntil
      );
      if (!dispatch) return "idle";

      try {
        await runTurn(conversationId, {
          replyIdempotencyKey: `agent:${dispatch.id}`,
        });
      } catch {
        await store.fail(
          dispatch.id,
          "agent_turn_failed",
          new Date(startedAt.getTime() + retryMs)
        );
        return "retry";
      }

      // Completion is outside the catch. If this write is ambiguous, keep the
      // lease and retry the same dispatch/key after expiry.
      await store.complete(dispatch.id, conversationId, startedAt);
      return "completed";
    },
  };
}