import { afterEach, describe, expect, it, vi } from "vitest";
import { createRunDeadline } from "@/server/lab/run-control";

describe("Lab run deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts at the deadline", () => {
    vi.useFakeTimers();
    const deadline = createRunDeadline(1_000);

    vi.advanceTimersByTime(1_000);

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timedOut()).toBe(true);
  });

  it("clears the timer after normal completion", () => {
    vi.useFakeTimers();
    const deadline = createRunDeadline(1_000);

    deadline.clear();
    vi.advanceTimersByTime(1_000);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.timedOut()).toBe(false);
  });
});