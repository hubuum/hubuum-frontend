import type {
	ReportInclude,
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedObject,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";

export type IncludeBuilderRow = {
	id: string;
	alias: string;
	classId: string;
	direction: ReportIncludeRelatedDirection;
	sort: ReportIncludeRelatedSort;
	limit: string;
	maxDepth: string;
};

export const INCLUDE_ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MAX_INCLUDE_ALIASES = 8;
export const INCLUDE_DIRECTIONS: ReportIncludeRelatedDirection[] = [
	"any",
	"outgoing",
	"incoming",
];
export const INCLUDE_SORTS: ReportIncludeRelatedSort[] = [
	"path",
	"name",
	"created_at",
];

export function newIncludeRow(id: string): IncludeBuilderRow {
	return {
		id,
		alias: "",
		classId: "",
		direction: "any",
		sort: "path",
		limit: "",
		maxDepth: "",
	};
}

export function includeAliasesOf(rows: IncludeBuilderRow[]): string[] {
	return rows
		.map((row) => row.alias.trim())
		.filter((alias) => INCLUDE_ALIAS_PATTERN.test(alias));
}

export function includeRowsFromTemplate(
	include: ReportInclude | null | undefined,
	makeId: () => string,
): IncludeBuilderRow[] {
	const related = include?.related_objects;
	if (!related) {
		return [];
	}
	return Object.entries(related).map(([alias, entry]) => ({
		id: makeId(),
		alias,
		classId: String(entry.class_id),
		direction: entry.direction ?? "any",
		sort: entry.sort ?? "path",
		limit: entry.limit != null ? String(entry.limit) : "",
		maxDepth: entry.max_depth != null ? String(entry.max_depth) : "",
	}));
}

function parsePositive(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function buildIncludeFromRows(
	rows: IncludeBuilderRow[],
): { include: ReportInclude | null } | { error: string } {
	if (!rows.length) {
		return { include: null };
	}
	if (rows.length > MAX_INCLUDE_ALIASES) {
		return { error: `At most ${MAX_INCLUDE_ALIASES} related includes are allowed.` };
	}
	const relatedObjects: Record<string, ReportIncludeRelatedObject> = {};
	for (const row of rows) {
		const alias = row.alias.trim();
		if (!INCLUDE_ALIAS_PATTERN.test(alias)) {
			return {
				error: `Include alias "${alias || "(empty)"}" must match [A-Za-z_][A-Za-z0-9_]*.`,
			};
		}
		if (relatedObjects[alias]) {
			return { error: `Duplicate include alias "${alias}".` };
		}
		const includeClassId = parsePositive(row.classId);
		if (!includeClassId) {
			return { error: `Include "${alias}" needs a class.` };
		}
		const entry: ReportIncludeRelatedObject = {
			class_id: includeClassId,
			direction: row.direction,
			sort: row.sort,
		};
		if (row.limit.trim()) {
			const limit = parsePositive(row.limit);
			if (!limit || limit > 50) {
				return { error: `Include "${alias}" limit must be 1..50.` };
			}
			entry.limit = limit;
		}
		if (row.maxDepth.trim()) {
			const maxDepth = parsePositive(row.maxDepth);
			if (!maxDepth || maxDepth > 10) {
				return { error: `Include "${alias}" max depth must be 1..10.` };
			}
			entry.max_depth = maxDepth;
		}
		relatedObjects[alias] = entry;
	}
	return { include: { related_objects: relatedObjects } };
}
