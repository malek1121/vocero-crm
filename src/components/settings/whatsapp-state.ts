export type ChannelErrorCode =
  | "connection_failed"
  | "credentials_save_failed"
  | "phone_mismatch";

/** Maps stable channel errors to safe user-facing copy. */
export function getChannelErrorMessage(
  error: string | null | undefined
): string | null {
  switch (error) {
    case null:
    case undefined:
      return null;
    case "connection_failed":
      return "No se pudo mantener la conexi\u00f3n con WhatsApp. Int\u00e9ntalo de nuevo.";
    case "credentials_save_failed":
      return "No se pudieron guardar las credenciales de WhatsApp. Vuelve a conectar el n\u00famero.";
    case "phone_mismatch":
      return "Ese n\u00famero no coincide con el WhatsApp guardado en esta organizaci\u00f3n.";
    default:
      return "WhatsApp inform\u00f3 un error. Int\u00e9ntalo de nuevo.";
  }
}
