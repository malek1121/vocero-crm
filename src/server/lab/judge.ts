import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { buildJudgePrompt } from "@/server/ai/prompts";

export { computeScore } from "@/server/lab/score";

/** Veredicto estructurado del juez (FR-032, contrato ai.md). */
export const Verdict = z.object({
  veredicto: z.enum(["verde", "amarillo", "rojo"]),
  hallazgos: z.array(
    z.object({
      tipo: z.enum(["alucinacion", "fuera_de_kb", "debio_escalar", "tono"]),
      evidencia: z.string(),
      sugerencia: z
        .object({ pregunta: z.string(), respuesta: z.string() })
        .optional(),
    })
  ),
});

export type VerdictType = z.infer<typeof Verdict>;

export type JudgeOutcome =
  | { status: "done"; verdict: VerdictType }
  | { status: "judge_failed"; detail: string };

export async function judgeCase(
  input: {
    personaKey: string;
    transcript: { role: "cliente" | "agente"; text: string }[];
    kbText: string;
    behaviorText: string;
  },
  signal?: AbortSignal
): Promise<JudgeOutcome> {
  const { system, user } = buildJudgePrompt({
    persona: input.personaKey,
    transcript: input.transcript,
    kbText: input.kbText,
    behaviorText: input.behaviorText,
  });
  const result = await chatJson(
    Verdict,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { judge: true, signal }
  );
  if (!result.ok) {
    console.error(`[lab] judge_failed code=${result.error}`);
    return { status: "judge_failed", detail: result.error };
  }
  return { status: "done", verdict: result.data };
}