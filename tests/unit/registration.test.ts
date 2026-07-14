import { describe, expect, it, vi } from "vitest";

let orgCount = 0;

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => Promise.resolve([{ n: orgCount }]),
    }),
  }),
  schema: { organization: {} },
}));

import { isPublicSignupAllowed } from "@/server/auth/registration";

describe("public signup gate", () => {
  it("allows the first account when no organization exists", async () => {
    orgCount = 0;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(true);
  });

  it("closes signup after the first organization", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "");
    expect(await isPublicSignupAllowed()).toBe(false);
  });

  it("cannot be reopened by an environment value", async () => {
    orgCount = 1;
    vi.stubEnv("ALLOW_SIGNUP", "true");
    expect(await isPublicSignupAllowed()).toBe(false);
  });
});