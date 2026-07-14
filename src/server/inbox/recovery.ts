export const RECOVERY_BATCH_SIZE = 100;
export const MAX_RECOVERY_ATTEMPTS = 5;

export type RecoveryCursor = { id: string; createdAt: Date };

export async function drainRecoveryPages<
  Row extends { id: string; createdAt: Date },
>(options: {
  loadPage: (cursor: RecoveryCursor | null) => Promise<Row[]>;
  deliver: (row: Row) => Promise<void>;
  onDeliveryError?: (id: string) => void | Promise<void>;
}): Promise<void> {
  let cursor: RecoveryCursor | null = null;
  while (true) {
    const rows = await options.loadPage(cursor);
    if (rows.length === 0) return;

    for (const row of rows) {
      try {
        await options.deliver(row);
      } catch {
        await options.onDeliveryError?.(row.id);
      }
    }

    if (rows.length < RECOVERY_BATCH_SIZE) return;

    const last = rows.at(-1)!;
    cursor = { id: last.id, createdAt: last.createdAt };
  }
}