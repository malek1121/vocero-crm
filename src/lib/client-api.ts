export async function apiRequest<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? fallbackMessage);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}