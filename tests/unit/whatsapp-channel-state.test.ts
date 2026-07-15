import { describe, expect, it } from "vitest";
import {
  getChannelErrorMessage,
  isWhatsappInboxAvailable,
} from "@/components/settings/whatsapp-state";

describe("WhatsApp channel error presentation", () => {
  it("maps stable server codes without exposing raw details", () => {
    expect(getChannelErrorMessage(null)).toBeNull();
    expect(getChannelErrorMessage("connection_failed")).toBe(
      "No se pudo mantener la conexión con WhatsApp. Inténtalo de nuevo."
    );
    expect(getChannelErrorMessage("credentials_save_failed")).toBe(
      "No se pudieron guardar las credenciales de WhatsApp. Vuelve a conectar el número."
    );
    expect(getChannelErrorMessage("phone_mismatch")).toBe(
      "Ese número no coincide con el WhatsApp guardado en esta organización."
    );
    expect(getChannelErrorMessage("unexpected provider payload")).toBe(
      "WhatsApp informó un error. Inténtalo de nuevo."
    );
  });
});

describe("WhatsApp inbox availability", () => {
  it("shows the landing after unlink even when a previous import completed", () => {
    expect(
      isWhatsappInboxAvailable({ status: "unlinked", initialImportComplete: true })
    ).toBe(false);
    expect(
      isWhatsappInboxAvailable({ status: "connected", initialImportComplete: true })
    ).toBe(true);
    expect(
      isWhatsappInboxAvailable({ status: "reconnecting", initialImportComplete: true })
    ).toBe(true);
    expect(
      isWhatsappInboxAvailable({ status: "connected", initialImportComplete: false })
    ).toBe(false);
  });
});
