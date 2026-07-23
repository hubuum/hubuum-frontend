const DATETIME_LOCAL_PATTERN =
	/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?$/;

/**
 * Serialize an HTML `datetime-local` value for the backend's Rust
 * `NaiveDateTime`. The value must remain timezone-less; converting it through
 * `Date#toISOString` adds `Z`, which chrono rejects as trailing input.
 */
export function toNaiveDateTimePayload(value: string): string | undefined {
	const trimmed = value.trim();
	if (!trimmed || !DATETIME_LOCAL_PATTERN.test(trimmed)) {
		return undefined;
	}

	return trimmed.length === 16 ? `${trimmed}:00` : trimmed;
}
