export type ResourceSummaryOptions = {
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
	if (loaded !== null && loaded !== undefined) {
		segments.push(
			`${loaded}${loadedNoun ? ` ${loadedNoun}` : ""} loaded`,
		);
	}
	if (total !== null && total !== undefined) {
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
