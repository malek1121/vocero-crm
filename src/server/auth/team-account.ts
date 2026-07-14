export type TeamAccountDependencies = {
  findUserByEmail: (
    email: string
  ) => Promise<{ id: string; hasMembership: boolean } | null>;
  removeUserIfOrphan: (userId: string) => Promise<boolean>;
  signUp: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<string>;
  attachMembership: (
    organizationId: string,
    userId: string
  ) => Promise<boolean>;
};

export class TeamAccountError extends Error {
  constructor(
    public readonly code:
      | "duplicate"
      | "signup_failed"
      | "membership_failed"
  ) {
    super(code);
    this.name = "TeamAccountError";
  }
}

export async function createTeamAccount(
  input: {
    name: string;
    email: string;
    password: string;
    organizationId: string;
  },
  dependencies: TeamAccountDependencies
): Promise<string> {
  const account = {
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
  };

  const existing = await dependencies.findUserByEmail(account.email);
  if (existing) {
    if (existing.hasMembership) throw new TeamAccountError("duplicate");
    try {
      if (!(await dependencies.removeUserIfOrphan(existing.id))) {
        throw new TeamAccountError("duplicate");
      }
    } catch (error) {
      if (error instanceof TeamAccountError) throw error;
      throw new TeamAccountError("signup_failed");
    }
  }

  let userId: string;
  try {
    userId = await dependencies.signUp(account);
  } catch {
    const concurrent = await dependencies.findUserByEmail(account.email);
    throw new TeamAccountError(concurrent ? "duplicate" : "signup_failed");
  }

  try {
    if (!(await dependencies.attachMembership(input.organizationId, userId))) {
      throw new Error("membership_not_inserted");
    }
  } catch {
    await dependencies.removeUserIfOrphan(userId).catch(() => false);
    throw new TeamAccountError("membership_failed");
  }

  return userId;
}