import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "@/server/inbox/cursor";

describe("inbox keyset cursor", () => {
  it("round-trips a timestamp and stable id", () => {
    const createdAt = new Date("2026-07-14T12:00:00.123Z");
    const encoded = encodeCursor({ createdAt, id: "msg_abc" });
    expect(encoded).not.toContain("+");
    expect(decodeCursor(encoded)).toEqual({ createdAt, id: "msg_abc" });
  });

  it("rejects malformed and incomplete cursors", () => {
    expect(decodeCursor("not-base64")) .toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ id: "x" })).toString("base64url"))).toBeNull();
  });

  it("preserves the id tie-breaker", () => {
    const createdAt = new Date(0);
    expect(decodeCursor(encodeCursor({ createdAt, id: "b" }))).toEqual({ createdAt, id: "b" });
  });
});