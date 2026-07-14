import { describe, expect, it } from "vitest";
import { getChannelErrorMessage } from "@/components/settings/whatsapp-state";

describe("WhatsApp channel error presentation", () => {
  it("maps stable server codes without exposing raw details", () => {
    expect(getChannelErrorMessage(null)).toBeNull();
    expect(getChannelErrorMessage("connection_failed")).toBe(
      "No se pudo mantener la conexi\u00f3n con WhatsApp. Int\u00e9ntalo de nuevo."
    );
    expect(getChannelErrorMessage("credentials_save_failed")).toBe(
      "No se pudieron guardar las credenciales de WhatsApp. Vuelve a conectar el n\u00famero."
    );
    expect(getChannelErrorMessage("phone_mismatch")).toBe(
      "Ese n\u00famero no coincide con el WhatsApp guardado en esta organizaci\u00f3n."
    );
    expect(getChannelErrorMessage("unexpected provider payload")).toBe(
      "WhatsApp inform\u00f3 un error. Int\u00e9ntalo de nuevo."
    );
  });
});
