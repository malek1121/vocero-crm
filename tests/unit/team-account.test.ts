import { describe, expect, it, vi } from "vitest";
import {
  TeamAccountError,
  createTeamAccount,
  type TeamAccountDependencies,
} from "@/server/auth/team-account";

function dependencies(
  overrides: Partial<TeamAccountDependencies> = {}
): TeamAccountDependencies {
  return {
    findUserByEmail: vi.fn().mockResolvedValue(null),
    removeUserIfOrphan: vi.fn().mockResolvedValue(true),
    signUp: vi.fn().mockResolvedValue("user_new"),
    attachMembership: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const input = { name: "Ada", email: "ADA@example.com ", password: "secret123", organizationId: "org_1" };

describe("membership-safe team account creation", () => {
  it("rejects an account that already has a membership", async () => {
    const deps = dependencies({
      findUserByEmail: vi.fn().mockResolvedValue({ id: "user_1", hasMembership: true }),
    });
    await expect(createTeamAccount(input, deps)).rejects.toMatchObject({ code: "duplicate" } satisfies Partial<TeamAccountError>);
    expect(deps.signUp).not.toHaveBeenCalled();
  });

  it("removes and recreates a membership-free orphan", async () => {
    const findUserByEmail = vi.fn()
      .mockResolvedValueOnce({ id: "orphan", hasMembership: false })
      .mockResolvedValue(null);
    const deps = dependencies({ findUserByEmail });
    await expect(createTeamAccount(input, deps)).resolves.toBe("user_new");
    expect(deps.removeUserIfOrphan).toHaveBeenCalledWith("orphan");
    expect(deps.signUp).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com", password: "secret123" });
    expect(deps.attachMembership).toHaveBeenCalledWith("org_1", "user_new");
  });

  it("compensates a failed membership insert", async () => {
    const deps = dependencies({ attachMembership: vi.fn().mockRejectedValue(new Error("database detail")) });
    await expect(createTeamAccount(input, deps)).rejects.toMatchObject({ code: "membership_failed" } satisfies Partial<TeamAccountError>);
    expect(deps.removeUserIfOrphan).toHaveBeenCalledWith("user_new");
  });

  it("classifies a concurrent duplicate without exposing provider text", async () => {
    const findUserByEmail = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner", hasMembership: true });
    const deps = dependencies({
      findUserByEmail,
      signUp: vi.fn().mockRejectedValue(new Error("sensitive provider error")),
    });
    await expect(createTeamAccount(input, deps)).rejects.toMatchObject({ code: "duplicate", message: "duplicate" } satisfies Partial<TeamAccountError>);
  });
});
