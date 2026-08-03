export type ResourceSummaryOptions = {
	compactLoadedTotal?: boolean;
	loaded?: number | null;
	loadedNoun?: string;
	shown?: number | null;
	shownLabel?: string;
	total?: number | null;
	totalLabel?: string;
	selected?: number;
	details?: readonly string[];
	status?: string | null;
};

export function buildResourceSummary({
	compactLoadedTotal = false,
	loaded,
	loadedNoun,
	shown,
	shownLabel = "shown",
	total,
	totalLabel = "total",
	selected = 0,
	details = [],
	status,
}: ResourceSummaryOptions): string[] {
	const segments: string[] = [];

	if (shown !== null && shown !== undefined) {
		segments.push(`${shown} ${shownLabel}`);
	}
	const hasLoaded = loaded !== null && loaded !== undefined;
	const hasTotal = total !== null && total !== undefined;
	if (compactLoadedTotal && hasLoaded && hasTotal && !loadedNoun) {
		segments.push(`${loaded} loaded`);
		segments.push(`${total} ${totalLabel}`);
	} else if (hasLoaded) {
		segments.push(
			`${loaded}${loadedNoun ? ` ${loadedNoun}` : ""} loaded`,
		);
	}
	if (hasTotal && !(compactLoadedTotal && hasLoaded && !loadedNoun)) {
		segments.push(`${total} ${totalLabel}`);
	}
	if (selected > 0) {
		segments.push(`${selected} selected`);
	}
	segments.push(...details.filter(Boolean));

	if (segments.length === 0 && status) {
		segments.push(status);
	}

	return segments;
}
