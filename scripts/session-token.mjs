// In-memory single-flight for development and live-test clients. No persistence.
export function sessionTokenProvider(initial, rotate) {
	function validate(pair) {
		const access = Date.parse(pair?.access_expires_at);
		const refresh = Date.parse(pair?.refresh_expires_at);
		const absolute = Date.parse(pair?.absolute_expires_at);
		if (
			pair?.token_type !== "Bearer" ||
			typeof pair.session_id !== "string" ||
			typeof pair.access_token !== "string" ||
			!pair.access_token ||
			typeof pair.refresh_token !== "string" ||
			!pair.refresh_token ||
			pair.access_token === pair.refresh_token ||
			!(Date.now() < access && access <= refresh && refresh <= absolute)
		) {
			throw new Error("Invalid interactive session response.");
		}
		return {
			pair,
			refreshAt:
				performance.now() +
				access -
				Date.now() -
				Math.min(30_000, (access - Date.now()) / 10),
		};
	}
	let current = validate(initial);
	let pending;
	return async () => {
		if (pending) return pending;
		if (!current)
			throw new Error("Interactive session unavailable; sign in again.");
		if (
			performance.now() < current.refreshAt &&
			Date.now() < Date.parse(current.pair.access_expires_at)
		)
			return current.pair.access_token;
		const previous = current.pair;
		current = null;
		pending = (async () => {
			if (Date.now() >= Date.parse(previous.refresh_expires_at))
				throw new Error("Interactive session expired.");
			const next = validate(await rotate(previous.refresh_token));
			if (
				next.pair.session_id !== previous.session_id ||
				Date.parse(next.pair.absolute_expires_at) !==
					Date.parse(previous.absolute_expires_at) ||
				next.pair.refresh_token === previous.refresh_token
			)
				throw new Error("Invalid session rotation.");
			current = next;
			return next.pair.access_token;
		})().catch(() => {
			throw new Error("Interactive refresh failed; sign in again.");
		});
		try {
			return await pending;
		} finally {
			pending = undefined;
		}
	};
}
