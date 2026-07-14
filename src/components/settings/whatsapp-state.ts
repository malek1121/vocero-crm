export type ChannelErrorCode =
  | "connection_failed"
  | "credentials_save_failed";

/** Maps stable channel errors to safe user-facing copy. */
export function getChannelErrorMessage(
  error: string | null | undefined
): string | null {
  switch (error) {
    case null:
    case undefined:
      return null;
    case "connection_failed":
      return "No se pudo mantener la conexión con WhatsApp. Inténtalo de nuevo.";
    case "credentials_save_failed":
      return "No se pudieron guardar las credenciales de WhatsApp. Vuelve a conectar el número.";
    default:
      return "WhatsApp informó un error. Inténtalo de nuevo.";
  }
}