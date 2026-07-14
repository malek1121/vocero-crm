export function computeScore(
  cases: { status: string; veredicto: string | null }[]
): number | null {
  if (
    cases.length === 0 ||
    cases.some((testCase) =>
      testCase.status !== "done" || testCase.veredicto === null
    )
  ) {
    return null;
  }

  const points = cases.reduce((total, testCase) => {
    if (testCase.veredicto === "verde") return total + 1;
    if (testCase.veredicto === "amarillo") return total + 0.5;
    return total;
  }, 0);
  return Math.round((100 * points) / cases.length);
}