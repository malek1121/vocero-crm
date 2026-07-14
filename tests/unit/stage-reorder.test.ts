import { describe, expect, it } from "vitest";
import { resolveStageSwap } from "@/server/pipeline/stage-reorder";

describe("pipeline stage reorder", () => {
  it("returns the two inverse position updates", () => {
    expect(
      resolveStageSwap(
        { id: "a", position: 1 },
        { id: "b", position: 4 }
      )
    ).toEqual([
      { id: "a", position: 4 },
      { id: "b", position: 1 },
    ]);
  });

  it("rejects the same stage on both sides", () => {
    expect(() =>
      resolveStageSwap(
        { id: "a", position: 1 },
        { id: "a", position: 1 }
      )
    ).toThrow("same_stage");
  });
});