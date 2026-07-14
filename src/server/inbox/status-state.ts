export type MessageStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

export function getStatusPersistence(next: MessageStatus): {
  status: MessageStatus;
  error: string | null;
  deliveryState: "sent" | "failed";
  lastErrorCode: string | null;
  deliveryLeaseUntil: null;
} {
  if (next === "failed") {
    return {
      status: next,
      error: "channel_failed",
      deliveryState: "failed",
      lastErrorCode: "channel_failed",
      deliveryLeaseUntil: null,
    };
  }

  return {
    status: next,
    error: null,
    deliveryState: "sent",
    lastErrorCode: null,
    deliveryLeaseUntil: null,
  };
}