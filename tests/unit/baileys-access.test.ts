import { describe, expect, it } from "vitest";
import { getChannelOwnerError } from "@/server/baileys/access";

describe("WhatsApp settings access", () => {
  it("allows owners", () => {
    expect(getChannelOwnerError("owner")).toBeNull();
  });

  it("rejects every non-owner role with the stable API error", () => {
    for (const role of ["member", "admin", ""]) {
      expect(getChannelOwnerError(role)).toEqual({
        status: 403,
        code: "forbidden",
        message: "Solo el propietario puede administrar WhatsApp",
      });
    }
  });
});