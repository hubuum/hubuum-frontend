import type { RecentItem } from "@/types/quick-access";

const RECENT_ITEMS_KEY = "hubuum.recent-items";
const MAX_RECENT_ITEMS = 50;

export function getRecentItems(): RecentItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(RECENT_ITEMS_KEY);
		if (!stored) {
			return [];
		}

		const items = JSON.parse(stored) as RecentItem[];
		return Array.isArray(items) ? items : [];
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
