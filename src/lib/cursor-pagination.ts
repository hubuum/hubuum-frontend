import { MAX_PAGE_LIMIT_SENTINEL } from "@/lib/server-page-limit";

export type CursorTrail = Array<string | null>;

const FALLBACK_PAGE_LIMIT = 100;

function clampPageLimit(value: number): number {
	return Math.min(MAX_PAGE_LIMIT_SENTINEL, Math.max(1, value));
}

export function normalizeCursorPageLimit(
	value: string | null,
	defaultLimit: number,
): number {
	const fallback =
		Number.isFinite(defaultLimit) && Number.isInteger(defaultLimit)
			? clampPageLimit(defaultLimit)
			: FALLBACK_PAGE_LIMIT;
	if (value === null || value.trim() === "") {
		return fallback;
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
		return fallback;
	}

	return clampPageLimit(parsed);
}

export function parseCursorTrail(value: string | null): CursorTrail {
	if (!value) {
		return [];
	}

	try {
		const parsed = JSON.parse(value) as unknown;
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter(
			(item): item is string | null =>
				item === null || (typeof item === "string" && item.length > 0),
		);
	} catch {
		return [];
	}
}

export function extendCursorTrail(
	trail: CursorTrail,
	currentCursor: string | undefined,
	nextCursor: string,
): CursorTrail {
	const currentEntry = currentCursor ?? null;
	const currentIndex = trail.lastIndexOf(currentEntry);
	const activeTrail =
		currentIndex >= 0 ? trail.slice(0, currentIndex + 1) : [currentEntry];

	if (!nextCursor || activeTrail[activeTrail.length - 1] === nextCursor) {
		return activeTrail;
	}

	return [...activeTrail, nextCursor];
}

export function hasPreviousCursorInTrail(
	trail: CursorTrail,
	currentCursor: string | undefined,
): boolean {
	return trail.lastIndexOf(currentCursor ?? null) > 0;
}

export function previousCursorFromTrail(
	trail: CursorTrail,
	currentCursor: string | undefined,
	fallbackCursor?: string,
): string | undefined {
	const currentIndex = trail.lastIndexOf(currentCursor ?? null);
	if (currentIndex <= 0) {
		return fallbackCursor;
	}

	return trail[currentIndex - 1] ?? undefined;
}
