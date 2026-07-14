import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_RATE_LIMIT,
  RATE_LIMIT_MAX_KEYS,
  checkRateLimit,
  rateLimitStoreSize,
  resetRateLimit,
} from "@/lib/rate-limit";

describe("in-process rate limit", () => {
  beforeEach(() => resetRateLimit());

  it("allows up to the maximum and blocks the next attempt", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) {
      expect(checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + i).allowed).toBe(true);
    }
    expect(checkRateLimit("login:1.2.3.4", AUTH_RATE_LIMIT, t0 + 100).allowed).toBe(false);
  });

  it("slides the window and prunes expired keys", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 300; i++) {
      checkRateLimit(`expired:${i}`, AUTH_RATE_LIMIT, t0);
    }
    checkRateLimit("fresh", AUTH_RATE_LIMIT, t0 + AUTH_RATE_LIMIT.windowMs + 1);
    expect(rateLimitStoreSize()).toBe(1);
  });

  it("caps unique keys under an address flood", () => {
    for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 50; i++) {
      checkRateLimit(`ip:${i}`, AUTH_RATE_LIMIT, 2_000_000 + i);
    }
    expect(rateLimitStoreSize()).toBeLessThanOrEqual(RATE_LIMIT_MAX_KEYS);
  });

  it("isolates keys", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT.max; i++) checkRateLimit("a", AUTH_RATE_LIMIT, t0 + i);
    expect(checkRateLimit("a", AUTH_RATE_LIMIT, t0 + 100).allowed).toBe(false);
    expect(checkRateLimit("b", AUTH_RATE_LIMIT, t0 + 100).allowed).toBe(true);
  });
});