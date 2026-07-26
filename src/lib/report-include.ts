import type {
	ReportInclude,
	ReportIncludeRelatedDirection,
	ReportIncludeRelatedObject,
	ReportIncludeRelatedSort,
} from "@/lib/api/reporting";
import { parsePositiveInteger } from "@/lib/number-input";

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
export const DEFAULT_INCLUDE_MAX_DEPTH = 1;
export const MAX_INCLUDE_MAX_DEPTH = 10;
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

export type RelatedClassPath = {
	id: number;
	path: readonly number[];
};

export type IncludeDepthRequirements = {
	minimumDepthByClassId?: ReadonlyMap<number, number>;
	requireKnownClassDepth?: boolean;
};

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

export function minimumIncludeDepthFromPath(
	path: readonly number[],
): number | null {
	if (
		path.length < 2 ||
		path.some((classId) => !Number.isSafeInteger(classId) || classId < 1)
	) {
		return null;
	}
	return path.length - 1;
}

export function buildRelatedClassMinimumDepths(
	classes: readonly RelatedClassPath[],
): Map<number, number> {
	const minimumDepthByClassId = new Map<number, number>();
	for (const classItem of classes) {
		const minimumDepth = minimumIncludeDepthFromPath(classItem.path);
		if (minimumDepth == null) continue;
		const currentMinimum = minimumDepthByClassId.get(classItem.id);
		if (currentMinimum == null || minimumDepth < currentMinimum) {
			minimumDepthByClassId.set(classItem.id, minimumDepth);
		}
	}
	return minimumDepthByClassId;
}

export function applyMinimumIncludeDepths(
	rows: IncludeBuilderRow[],
	minimumDepthByClassId: ReadonlyMap<number, number>,
): IncludeBuilderRow[] {
	let changed = false;
	const nextRows = rows.map((row) => {
		const classId = parsePositiveInteger(row.classId);
		const minimumDepth =
			classId == null ? null : minimumDepthByClassId.get(classId);
		if (minimumDepth == null || minimumDepth <= DEFAULT_INCLUDE_MAX_DEPTH) {
			return row;
		}
		const configuredDepth = row.maxDepth.trim()
			? parsePositiveInteger(row.maxDepth)
			: DEFAULT_INCLUDE_MAX_DEPTH;
		if (configuredDepth != null && configuredDepth >= minimumDepth) {
			return row;
		}
		changed = true;
		return { ...row, maxDepth: String(minimumDepth) };
	});
	return changed ? nextRows : rows;
}

export function buildIncludeFromRows(
	rows: IncludeBuilderRow[],
	depthRequirements: IncludeDepthRequirements = {},
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
		const includeClassId = parsePositiveInteger(row.classId);
		if (!includeClassId) {
			return { error: `Include "${alias}" needs a class.` };
		}
		const minimumDepth =
			depthRequirements.minimumDepthByClassId?.get(includeClassId);
		if (
			depthRequirements.requireKnownClassDepth &&
			minimumDepth == null
		) {
			return {
				error: `Include "${alias}" must target a class connected to the export class.`,
			};
		}
		const entry: ReportIncludeRelatedObject = {
			class_id: includeClassId,
			direction: row.direction,
			sort: row.sort,
		};
		if (row.limit.trim()) {
			const limit = parsePositiveInteger(row.limit);
			if (!limit || limit > 50) {
				return { error: `Include "${alias}" limit must be 1..50.` };
			}
			entry.limit = limit;
		}
		if (row.maxDepth.trim()) {
			const maxDepth = parsePositiveInteger(row.maxDepth);
			if (!maxDepth || maxDepth > MAX_INCLUDE_MAX_DEPTH) {
				return {
					error: `Include "${alias}" max depth must be 1..${MAX_INCLUDE_MAX_DEPTH}.`,
				};
			}
			entry.max_depth = maxDepth;
		}
		const effectiveDepth =
			entry.max_depth ?? DEFAULT_INCLUDE_MAX_DEPTH;
		if (minimumDepth != null && minimumDepth > MAX_INCLUDE_MAX_DEPTH) {
			return {
				error: `Include "${alias}" needs depth ${minimumDepth} to reach its class, but the maximum supported depth is ${MAX_INCLUDE_MAX_DEPTH}.`,
			};
		}
		if (minimumDepth != null && effectiveDepth < minimumDepth) {
			return {
				error: `Include "${alias}" max depth must be at least ${minimumDepth} to reach its class.`,
			};
		}
		relatedObjects[alias] = entry;
	}
	return { include: { related_objects: relatedObjects } };
}
