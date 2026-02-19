export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybeMessage = (payload as { message?: unknown }).message;
  if (typeof maybeMessage !== "string" || !maybeMessage.trim()) {
    return fallback;
  }

  return maybeMessage;
}

export function expectArrayPayload<T>(payload: unknown, context: string): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload === null || payload === undefined) {
    return [];
  }

  throw new Error(`Unexpected response format for ${context}.`);
}
