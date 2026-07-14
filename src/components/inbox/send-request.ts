export type PendingSendRequest = {
  text: string;
  idempotencyKey: string;
};

export function getPendingSendRequest(
  current: PendingSendRequest | null,
  text: string,
  generateId: () => string = () => crypto.randomUUID()
): PendingSendRequest {
  if (current?.text === text) return current;
  return { text, idempotencyKey: generateId() };
}