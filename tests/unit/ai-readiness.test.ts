import { afterEach, describe, expect, it, vi } from "vitest";
import { isAiConfigured } from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("AI readiness", () => {
  it("requires both a token and a model", () => {
    vi.stubEnv("AI_API_TOKEN", "token");
    vi.stubEnv("AI_MODEL", "");
    expect(isAiConfigured()).toBe(false);
  });

  it("is ready when token and model are non-empty", () => {
    vi.stubEnv("AI_API_TOKEN", "token");
    vi.stubEnv("AI_MODEL", "model");
    expect(isAiConfigured()).toBe(true);
  });

  it("rejects whitespace-only values", () => {
    vi.stubEnv("AI_API_TOKEN", "   ");
    vi.stubEnv("AI_MODEL", "  ");
    expect(isAiConfigured()).toBe(false);
  });
});