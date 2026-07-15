export type SessionLifecycle<TSocket> = {
  generation: number;
  stopped: boolean;
  socket: TSocket | null;
  startPromise: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

export function createSessionLifecycle<TSocket>(): SessionLifecycle<TSocket> {
  return {
    generation: 0,
    stopped: false,
    socket: null,
    startPromise: null,
    reconnectTimer: null,
  };
}

export function beginSessionGeneration<TSocket>(
  state: SessionLifecycle<TSocket>,
  explicit: boolean
): number | null {
  if (state.startPromise || (!explicit && state.stopped)) return null;
  if (explicit) state.stopped = false;
  state.generation += 1;
  return state.generation;
}

export function isCurrentSession<TSocket>(
  state: SessionLifecycle<TSocket>,
  generation: number,
  socket?: TSocket
): boolean {
  return (
    !state.stopped &&
    state.generation === generation &&
    (socket === undefined || state.socket === socket)
  );
}

export function replaceReconnectTimer<TSocket>(
  state: SessionLifecycle<TSocket>,
  timer: ReturnType<typeof setTimeout> | null,
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout
): void {
  if (state.reconnectTimer) clearTimer(state.reconnectTimer);
  state.reconnectTimer = timer;
}

export function stopSessionLifecycle<TSocket>(
  state: SessionLifecycle<TSocket>,
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout
): TSocket | null {
  state.generation += 1;
  state.stopped = true;
  state.startPromise = null;
  replaceReconnectTimer(state, null, clearTimer);
  const socket = state.socket;
  state.socket = null;
  return socket;
}
export type ExplicitUnlinkState = {
  storedPhone: string | null;
  initialImportComplete: boolean;
  syncProgress: number | null;
  syncDone: boolean;
};

export function resetExplicitUnlinkState(state: ExplicitUnlinkState): void {
  state.storedPhone = null;
  state.initialImportComplete = false;
  state.syncProgress = null;
  state.syncDone = false;
}

export type ProviderLogoutSocket = {
  logout(): Promise<unknown>;
};

export function startBestEffortLogout(
  socket: ProviderLogoutSocket | null | undefined
): void {
  if (!socket) return;
  try {
    void socket.logout().catch(() => undefined);
  } catch {
    // Provider cleanup is best-effort; durable state is authoritative.
  }
}
