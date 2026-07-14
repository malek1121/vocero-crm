import { describe, expect, it } from "vitest";
import { computeScore } from "@/server/lab/score";

describe("truthful Lab score", () => {
  it("returns null when any case lacks a valid verdict", () => {
    expect(
      computeScore([
        { status: "done", veredicto: "verde" },
        { status: "judge_failed", veredicto: null },
      ])
    ).toBeNull();
  });

  it("scores only a fully judged set", () => {
    expect(
      computeScore([
        { status: "done", veredicto: "verde" },
        { status: "done", veredicto: "amarillo" },
        { status: "done", veredicto: "rojo" },
      ])
    ).toBe(50);
  });
});