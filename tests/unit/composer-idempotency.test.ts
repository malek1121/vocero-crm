import { describe, expect, it, vi } from "vitest";
import { getPendingSendRequest } from "@/components/inbox/send-request";

describe("composer idempotency", () => {
  it("reuses one UUID for retries of the same immutable text", () => {
    const generate = vi
      .fn()
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");

    const first = getPendingSendRequest(null, "Hola", generate);
    const retry = getPendingSendRequest(first, "Hola", generate);
    const changed = getPendingSendRequest(retry, "Hola de nuevo", generate);

    expect(retry).toBe(first);
    expect(changed.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});