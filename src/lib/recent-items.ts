import type { RecentItem } from "@/types/quick-access";

const RECENT_ITEMS_KEY = "hubuum.recent-items";
const MAX_RECENT_ITEMS = 50;
const RECENT_ITEM_TYPES = new Set([
	"collection",
	"class",
	"object",
	"task",
	"admin-user",
	"admin-group",
	"service-account",
]);

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) > 0;
}

function normalizeRecentItem(value: unknown): RecentItem | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const item = value as Record<string, unknown>;
	const type = item.type;
	if (typeof type !== "string" || !RECENT_ITEM_TYPES.has(type)) {
		return null;
	}
	if (!isPositiveInteger(item.id)) {
		return null;
	}
	if (type === "object" && !isPositiveInteger(item.classId)) {
		return null;
	}

	const name = typeof item.name === "string" && item.name.trim()
		? item.name
		: `${type} ${item.id}`;
	const timestamp = typeof item.timestamp === "number" && Number.isFinite(item.timestamp)
		? item.timestamp
		: Date.now();

	return {
		type: type as RecentItem["type"],
		id: item.id,
		name,
		timestamp,
		...(isPositiveInteger(item.classId) ? { classId: item.classId } : {}),
		...(isPositiveInteger(item.collectionId)
			? { collectionId: item.collectionId }
			: {}),
	};
}

export function getRecentItems(): RecentItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(RECENT_ITEMS_KEY);
		if (!stored) {
			return [];
		}

		const parsed = JSON.parse(stored);
		if (!Array.isArray(parsed)) {
			return [];
		}

		const items = parsed
			.map(normalizeRecentItem)
			.filter((item): item is RecentItem => item !== null)
			.slice(0, MAX_RECENT_ITEMS);
		if (items.length !== parsed.length || JSON.stringify(items) !== stored) {
			window.localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(items));
		}
		return items;
	} catch {
		return [];
	}
}

export function trackRecentItem(item: Omit<RecentItem, "timestamp">): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getRecentItems();
		const filtered = existing.filter(
			(i) => !(i.type === item.type && i.id === item.id),
		);

		const updated: RecentItem[] = [
			{ ...item, timestamp: Date.now() },
			...filtered,
		].slice(0, MAX_RECENT_ITEMS);

		window.localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(updated));
	} catch {
		// Silently fail if localStorage is unavailable
	}
}

export function clearRecentItems(): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.removeItem(RECENT_ITEMS_KEY);
	} catch {
		// Silently fail
	}
}
