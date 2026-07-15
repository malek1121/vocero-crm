import { describe, expect, it, vi } from "vitest";
import {
  beginSessionGeneration,
  createSessionLifecycle,
  isCurrentSession,
  replaceReconnectTimer,
  resetExplicitUnlinkState,
  stopSessionLifecycle,
} from "@/server/baileys/lifecycle";

describe("Baileys session lifecycle", () => {
  it("keeps starts single-flight and only explicit start clears stopped", async () => {
    const state = createSessionLifecycle<object>();
    state.stopped = true;

    expect(beginSessionGeneration(state, false)).toBeNull();
    expect(state.generation).toBe(0);

    expect(beginSessionGeneration(state, true)).toBe(1);
    expect(state.stopped).toBe(false);

    state.startPromise = Promise.resolve();
    expect(beginSessionGeneration(state, true)).toBeNull();
    await state.startPromise;
  });

  it("accepts mutations only from the current generation and socket", () => {
    const state = createSessionLifecycle<object>();
    const first = {};
    const second = {};
    const generation = beginSessionGeneration(state, true)!;
    state.socket = first;

    expect(isCurrentSession(state, generation, first)).toBe(true);
    state.stopped = true;
    expect(isCurrentSession(state, generation, first)).toBe(false);
    state.stopped = false;
    expect(isCurrentSession(state, generation - 1, first)).toBe(false);
    expect(isCurrentSession(state, generation, second)).toBe(false);
  });

  it("keeps one reconnect timer", () => {
    const state = createSessionLifecycle<object>();
    const clearTimer = vi.fn();
    const first = { id: 1 } as unknown as ReturnType<typeof setTimeout>;
    const second = { id: 2 } as unknown as ReturnType<typeof setTimeout>;

    replaceReconnectTimer(state, first, clearTimer);
    replaceReconnectTimer(state, second, clearTimer);

    expect(clearTimer).toHaveBeenCalledOnce();
    expect(clearTimer).toHaveBeenCalledWith(first);
    expect(state.reconnectTimer).toBe(second);
  });

  it("invalidates pending work and detaches the socket on stop", () => {
    const state = createSessionLifecycle<object>();
    const socket = {};
    const timer = { id: 1 } as unknown as ReturnType<typeof setTimeout>;
    const clearTimer = vi.fn();
    state.socket = socket;
    state.reconnectTimer = timer;
    state.startPromise = Promise.resolve();

    expect(stopSessionLifecycle(state, clearTimer)).toBe(socket);
    expect(state.generation).toBe(1);
    expect(state.stopped).toBe(true);
    expect(state.socket).toBeNull();
    expect(state.startPromise).toBeNull();
    expect(state.reconnectTimer).toBeNull();
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });

  it("resets only WhatsApp binding and import state on explicit unlink", () => {
    const state = {
      storedPhone: "51999999999",
      initialImportComplete: true,
      syncProgress: 84,
      syncDone: true,
    };

    resetExplicitUnlinkState(state);

    expect(state).toEqual({
      storedPhone: null,
      initialImportComplete: false,
      syncProgress: null,
      syncDone: false,
    });
  });
});
