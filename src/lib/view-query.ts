export type ViewQueryPatch = Record<string, string | readonly string[] | null>;

export function patchViewQuery(url: URL, patch: ViewQueryPatch): string {
	for (const [key, value] of Object.entries(patch)) {
		url.searchParams.delete(key);
		if (value === null) continue;
		for (const item of typeof value === "string" ? [value] : value) {
			url.searchParams.append(key, item);
		}
	}
	return `${url.pathname}${url.search}${url.hash}`;
}

// Next's native History integration updates useSearchParams without a server navigation.
// Read the current URL at the event, so consecutive edits cannot overwrite one another.
export function updateViewQuery(
	patch: ViewQueryPatch,
	mode: "replace" | "push" = "replace",
): void {
	const url = new URL(window.location.href);
	const previous = `${url.pathname}${url.search}${url.hash}`;
	const next = patchViewQuery(url, patch);
	if (next !== previous) {
		window.history[mode === "push" ? "pushState" : "replaceState"](
			null,
			"",
			next,
		);
	}
}
