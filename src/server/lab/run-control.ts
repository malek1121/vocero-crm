export function createRunDeadline(timeoutMs: number): {
  signal: AbortSignal;
  timedOut(): boolean;
  clear(): void;
} {
  const controller = new AbortController();
  let timeoutReached = false;
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    clear: () => clearTimeout(timer),
  };
}