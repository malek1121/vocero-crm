import { describe, expect, it, vi } from "vitest";
import {
  MAX_RECOVERY_ATTEMPTS,
  RECOVERY_BATCH_SIZE,
  drainRecoveryPages,
} from "@/server/inbox/recovery";

type Row = { id: string; createdAt: Date };

describe("outbound recovery paging", () => {
  it("drains more than one deterministic batch exactly once", async () => {
    const rows: Row[] = Array.from({ length: RECOVERY_BATCH_SIZE * 2 + 5 }, (_, index) => ({
      id: String(index).padStart(4, "0"),
      createdAt: new Date(1_000_000 + index),
    }));
    const visited: string[] = [];
    const batchSizes: number[] = [];

    await drainRecoveryPages<Row>({
      loadPage: async (cursor) => {
        const start = cursor ? rows.findIndex((row) => row.id === cursor.id) + 1 : 0;
        const page = rows.slice(start, start + RECOVERY_BATCH_SIZE);
        batchSizes.push(page.length);
        return page;
      },
      deliver: async (row) => {
        visited.push(row.id);
      },
    });

    expect(batchSizes).toEqual([100, 100, 5]);
    expect(visited).toEqual(rows.map((row) => row.id));
    expect(new Set(visited).size).toBe(rows.length);
  });

  it("continues after a poison message and reports one stable error", async () => {
    const rows: Row[] = [
      { id: "a", createdAt: new Date(1) },
      { id: "b", createdAt: new Date(2) },
      { id: "c", createdAt: new Date(3) },
    ];
    const visited: string[] = [];
    const onDeliveryError = vi.fn();
    await drainRecoveryPages<Row>({
      loadPage: async (cursor) => (cursor ? [] : rows),
      deliver: async (row) => {
        visited.push(row.id);
        if (row.id === "b") throw new Error("provider detail");
      },
      onDeliveryError,
    });
    expect(visited).toEqual(["a", "b", "c"]);
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(onDeliveryError).toHaveBeenCalledWith("b");
  });

  it("uses a finite attempt ceiling", () => {
    expect(MAX_RECOVERY_ATTEMPTS).toBe(5);
  });
});