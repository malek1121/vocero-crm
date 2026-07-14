export type ChannelAccessError = {
  status: 403;
  code: "forbidden";
  message: string;
};

/** Returns the stable API error for WhatsApp settings reserved to owners. */
export function getChannelOwnerError(role: string): ChannelAccessError | null {
  if (role === "owner") return null;

  return {
    status: 403,
    code: "forbidden",
    message: "Solo el propietario puede administrar WhatsApp",
  };
}