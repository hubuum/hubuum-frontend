export const CORRELATION_ID_HEADER = "x-correlation-id";
export const CORRELATION_ID_COOKIE = "hubuum.cid";
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function generateCorrelationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function normalizeCorrelationId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!CORRELATION_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}
