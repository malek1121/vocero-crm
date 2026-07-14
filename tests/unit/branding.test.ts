import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  isValidHex,
  normalizeBranding,
  resolveAccentSet,
} from "@/lib/branding";

function contrastWithWhite(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
  return 1.05 / (luminance + 0.05);
}

describe("white-label: acento", () => {
  it("preset devuelve el set exacto del handoff", () => {
    expect(resolveAccentSet("#3f5972")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
    expect(resolveAccentSet("#5f5470").soft).toBe("#e6e1ec");
  });

  it("color personalizado deriva hover/soft/tint/text", () => {
    const s = resolveAccentSet("#7a3b5e");
    expect(isValidHex(s.hover)).toBe(true);
    expect(isValidHex(s.soft)).toBe(true);
    expect(isValidHex(s.tint)).toBe(true);
    expect(s.hover).not.toBe(s.accent);
  });

  it("color demasiado claro se oscurece para contraste con texto blanco", () => {
    const s = resolveAccentSet("#ffee88"); // amarillo pálido, ilegible con blanco
    expect(s.accent).not.toBe("#ffee88");
    expect(contrastWithWhite(s.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("hex inválido cae al default", () => {
    expect(resolveAccentSet("rojo")).toEqual(ACCENT_PRESETS["#3f5972"]!.set);
  });
});

describe("white-label: normalización", () => {
  it("nombre vacío o nulo → default 'Vocero'; se recorta a 30", () => {
    expect(normalizeBranding(null).name).toBe("Vocero");
    expect(normalizeBranding({ name: "   " }).name).toBe("Vocero");
    expect(normalizeBranding({ name: "x".repeat(50) }).name).toHaveLength(30);
  });

  it("acento inválido → default", () => {
    expect(normalizeBranding({ accent: "azul" }).accent).toBe("#3f5972");
    expect(normalizeBranding({ accent: "#3F6B66" }).accent).toBe("#3f6b66");
  });
});
