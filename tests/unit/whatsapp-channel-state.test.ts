import { describe, expect, it } from "vitest";
import { getChannelErrorMessage } from "@/components/settings/whatsapp-state";

describe("WhatsApp channel error presentation", () => {
  it("maps stable server codes without exposing raw details", () => {
    expect(getChannelErrorMessage(null)).toBeNull();
    expect(getChannelErrorMessage("connection_failed")).toBe(
      "No se pudo mantener la conexión con WhatsApp. Inténtalo de nuevo."
    );
    expect(getChannelErrorMessage("credentials_save_failed")).toBe(
      "No se pudieron guardar las credenciales de WhatsApp. Vuelve a conectar el número."
    );
    expect(getChannelErrorMessage("unexpected provider payload")).toBe(
      "WhatsApp informó un error. Inténtalo de nuevo."
    );
  });
});