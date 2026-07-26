export const MAX_IDEMPOTENCY_KEY_BYTES = 255;

export function normalizeIdempotencyKey(
	value?: string | null,
): string | undefined {
	const normalized = value?.trim();
	if (!normalized) {
		return undefined;
	}

	const byteLength = new TextEncoder().encode(normalized).byteLength;
	if (byteLength > MAX_IDEMPOTENCY_KEY_BYTES) {
		throw new Error(
			`Idempotency keys must be ${MAX_IDEMPOTENCY_KEY_BYTES} bytes or fewer.`,
		);
	}
	return normalized;
}
