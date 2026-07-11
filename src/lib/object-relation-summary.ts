export type RelatedObjectDataSummary = {
	label: string;
	value: string;
};

export type RelatedObjectQueryOptions = {
	depthLimit: number;
	includeSelfClass: boolean;
	ignoredClassIds: number[];
	limit?: number;
	sort?: string;
};

export const DEFAULT_INCLUDE_SELF_CLASS = false;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSummaryValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `${value.length} item${value.length === 1 ? "" : "s"}`;
	}
	if (isRecord(value)) {
		const count = Object.keys(value).length;
		return `${count} field${count === 1 ? "" : "s"}`;
	}
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		return value.length > 52 ? `${value.slice(0, 49)}...` : value;
	}
	return String(value);
}

export function buildRelatedObjectSearchParams({
	depthLimit,
	includeSelfClass,
	ignoredClassIds,
	limit = 250,
	sort = "path.asc,id.asc",
}: RelatedObjectQueryOptions): URLSearchParams {
	const params = new URLSearchParams({
		limit: String(limit),
		sort,
		depth__lte: String(depthLimit),
		ignore_self_class: String(!includeSelfClass),
	});

	if (ignoredClassIds.length > 0) {
		params.set("ignore_classes", ignoredClassIds.join(","));
	}

	return params;
}

export function normalizeRelatedObjectPath(
	rootObjectId: number,
	targetObjectId: number,
	path: number[],
): number[] {
	const normalized = path.length ? [...path] : [targetObjectId];
	if (normalized[0] === rootObjectId) {
		normalized.shift();
	}
	if (!normalized.length || normalized.at(-1) !== targetObjectId) {
		normalized.push(targetObjectId);
	}
	return normalized;
}

export function summarizeRelatedObjectData(
	value: unknown,
	limit = 3,
): RelatedObjectDataSummary[] {
	if (!isRecord(value) || limit < 1) {
		return [];
	}
	return Object.entries(value)
		.sort(([left], [right]) => left.localeCompare(right))
		.slice(0, limit)
		.map(([label, entryValue]) => ({
			label,
			value: formatSummaryValue(entryValue),
		}));
}
