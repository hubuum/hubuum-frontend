const LOCAL_ORIGIN = "https://hubuum.invalid";

export function normalizeReturnPath(
	value: string | null | undefined,
	fallback = "/app",
): string {
	const candidate = value?.trim();
	if (!candidate) {
		return fallback;
	}

	try {
		const parsed = new URL(candidate, LOCAL_ORIGIN);
		if (parsed.origin !== LOCAL_ORIGIN || !candidate.startsWith("/")) {
			return fallback;
		}

		return `${parsed.pathname}${parsed.search}${parsed.hash}`;
	} catch {
		return fallback;
	}
}
