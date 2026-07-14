import { describe, expect, it } from "vitest";
import { getStatusPersistence } from "@/server/inbox/status-state";

describe("message status persistence", () => {
  it("stores only a stable code for channel failures", () => {
    expect(getStatusPersistence("failed")).toEqual({
      status: "failed",
      error: "channel_failed",
      deliveryState: "failed",
      lastErrorCode: "channel_failed",
      deliveryLeaseUntil: null,
    });
  });

  it("a provider acknowledgement resolves ambiguous delivery", () => {
    expect(getStatusPersistence("delivered")).toEqual({
      status: "delivered",
      error: null,
      deliveryState: "sent",
      lastErrorCode: null,
      deliveryLeaseUntil: null,
    });
  });
});