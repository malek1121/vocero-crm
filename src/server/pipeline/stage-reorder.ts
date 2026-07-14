export function resolveStageSwap(
  first: { id: string; position: number },
  second: { id: string; position: number }
): [{ id: string; position: number }, { id: string; position: number }] {
  if (first.id === second.id) throw new Error("same_stage");
  return [
    { id: first.id, position: second.position },
    { id: second.id, position: first.position },
  ];
}