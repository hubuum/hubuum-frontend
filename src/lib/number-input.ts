export function parsePositiveInteger(value: string): number | null {
	const normalized = value.trim();
	if (!/^[1-9]\d*$/.test(normalized)) {
		return null;
	}

	const parsed = Number.parseInt(normalized, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
}
