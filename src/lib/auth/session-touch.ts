const MAX_SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1_000;

export function getSessionTouchIntervalMs(ttlSeconds: number): number {
	const ttlMilliseconds = ttlSeconds * 1_000;
	return Math.max(
		1,
		Math.min(MAX_SESSION_TOUCH_INTERVAL_MS, Math.floor(ttlMilliseconds / 4)),
	);
}

export function shouldTouchSession(
	lastSeen: number,
	now: number,
	ttlSeconds: number,
): boolean {
	if (!Number.isFinite(lastSeen) || now < lastSeen) {
		return true;
	}

	return now - lastSeen >= getSessionTouchIntervalMs(ttlSeconds);
}
