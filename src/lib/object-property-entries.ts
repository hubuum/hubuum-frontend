export const DEFAULT_OBJECT_PROPERTY_MAX_DEPTH = 8;
export const DEFAULT_OBJECT_PROPERTY_MAX_ENTRIES = 200;

export type ObjectPropertyPathSegment = string | number;

export type ObjectPropertyEntryKind =
	| "primitive"
	| "empty-object"
	| "empty-array"
	| "object-summary"
	| "array-summary";

export type ObjectPropertyEntry = {
	readonly id: string;
	readonly path: string;
	readonly label: string;
	readonly value: string;
	readonly kind: ObjectPropertyEntryKind;
	readonly segments: readonly ObjectPropertyPathSegment[];
};

export type FlattenObjectPropertyEntriesOptions = {
	maxDepth?: number;
	maxEntries?: number;
};

export type ObjectPropertyEntriesResult = {
	entries: ObjectPropertyEntry[];
	truncated: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareKeys(left: string, right: string): number {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(0, Math.floor(value));
}

function escapePathKey(key: string): string {
	let escaped = "";
	for (const character of key) {
		escaped += ["\\", ".", "[", "]"].includes(character)
			? `\\${character}`
			: character;
	}
	return escaped;
}

function containsControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) {
			return true;
		}
	}
	return false;
}

function formatPath(segments: readonly ObjectPropertyPathSegment[]): string {
	if (segments.length === 0) {
		return "$";
	}

	let path = "";
	for (const segment of segments) {
		if (typeof segment === "number") {
			path += `[${segment}]`;
			continue;
		}

		if (segment.length === 0) {
			path += `[""]`;
			continue;
		}

		path += `${path.length > 0 ? "." : ""}${escapePathKey(segment)}`;
	}
	return path;
}

function formatPrimitive(value: unknown): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		if (
			value.length === 0 ||
			/^\s+$/.test(value) ||
			containsControlCharacter(value)
		) {
			return JSON.stringify(value);
		}
		return value;
	}
	if (typeof value === "number" && Object.is(value, -0)) {
		return "-0";
	}
	if (typeof value === "bigint") {
		return `${value.toString()}n`;
	}
	return String(value);
}

function formatCount(count: number, singular: string, plural: string): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Flattens JSON-like data into stable, display-ready leaf rows.
 *
 * Object keys use escaped dotted paths, while array positions use bracketed
 * indices. A depth-capped container is represented by a summary row and marks
 * the result as truncated. Neither the input nor its nested values are changed.
 */
export function flattenObjectPropertyEntries(
	value: unknown,
	options: FlattenObjectPropertyEntriesOptions = {},
): ObjectPropertyEntriesResult {
	const maxDepth = normalizeLimit(
		options.maxDepth,
		DEFAULT_OBJECT_PROPERTY_MAX_DEPTH,
	);
	const maxEntries = normalizeLimit(
		options.maxEntries,
		DEFAULT_OBJECT_PROPERTY_MAX_ENTRIES,
	);
	const entries: ObjectPropertyEntry[] = [];
	let truncated = false;

	function appendEntry(
		segments: readonly ObjectPropertyPathSegment[],
		entryValue: string,
		kind: ObjectPropertyEntryKind,
	): void {
		if (entries.length >= maxEntries) {
			truncated = true;
			return;
		}

		const entrySegments = [...segments];
		const path = formatPath(entrySegments);
		entries.push({
			id: JSON.stringify(entrySegments),
			path,
			label: path,
			value: entryValue,
			kind,
			segments: entrySegments,
		});
	}

	function visit(
		currentValue: unknown,
		segments: readonly ObjectPropertyPathSegment[],
		depth: number,
	): void {
		if (entries.length >= maxEntries) {
			truncated = true;
			return;
		}

		if (Array.isArray(currentValue)) {
			if (currentValue.length === 0) {
				appendEntry(segments, "Empty array", "empty-array");
				return;
			}
			if (depth >= maxDepth) {
				appendEntry(
					segments,
					formatCount(currentValue.length, "item", "items"),
					"array-summary",
				);
				truncated = true;
				return;
			}

			for (let index = 0; index < currentValue.length; index += 1) {
				visit(currentValue[index], [...segments, index], depth + 1);
			}
			return;
		}

		if (isRecord(currentValue)) {
			const keys = Object.keys(currentValue).sort(compareKeys);
			if (keys.length === 0) {
				appendEntry(segments, "Empty object", "empty-object");
				return;
			}
			if (depth >= maxDepth) {
				appendEntry(
					segments,
					formatCount(keys.length, "field", "fields"),
					"object-summary",
				);
				truncated = true;
				return;
			}

			for (const key of keys) {
				visit(currentValue[key], [...segments, key], depth + 1);
			}
			return;
		}

		appendEntry(segments, formatPrimitive(currentValue), "primitive");
	}

	visit(value, [], 0);
	return { entries, truncated };
}
