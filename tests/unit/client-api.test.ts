import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "@/lib/client-api";

afterEach(() => vi.unstubAllGlobals());

describe("client API requests", () => {
  it("returns JSON for a successful response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true })));
    await expect(apiRequest<{ ok: boolean }>("/ok", undefined, "Falló")).resolves.toEqual({ ok: true });
  });

  it("throws the safe API message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ error: { message: "Corrige este dato" } }, { status: 422 })
      )
    );
    await expect(apiRequest("/bad", undefined, "Falló")).rejects.toThrow("Corrige este dato");
  });

  it("uses the fallback for network and malformed errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private detail")));
    await expect(apiRequest("/offline", undefined, "Sin conexión")).rejects.toThrow("Sin conexión");
  });
});