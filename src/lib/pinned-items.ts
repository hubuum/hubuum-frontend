import type {
	PinnedItem,
	PinnedItemType,
	ClassPinAction,
} from "@/types/quick-access";
import { writeUserSetting } from "@/lib/user-settings-client";
import { PORTABLE_USER_SETTING_KEYS } from "@/lib/user-settings-types";

const PINNED_ITEMS_KEY = PORTABLE_USER_SETTING_KEYS.pinnedItems;
const MAX_PINNED_ITEMS = 10;
const PINNED_ITEM_TYPES = new Set(["collection", "class", "object"]);

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && Number(value) > 0;
}

function normalizePinnedItem(value: unknown): PinnedItem | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const item = value as Record<string, unknown>;
	const type = item.type;
	if (typeof type !== "string" || !PINNED_ITEM_TYPES.has(type)) {
		return null;
	}
	if (!isPositiveInteger(item.id)) {
		return null;
	}
	if (type === "object" && !isPositiveInteger(item.classId)) {
		return null;
	}

	const action = item.action === "create" ? "create" : "view";
	const name =
		typeof item.name === "string" && item.name.trim()
			? item.name
			: `${type} ${item.id}`;
	const timestamp =
		typeof item.timestamp === "number" && Number.isFinite(item.timestamp)
			? item.timestamp
			: Date.now();

	return {
		type: type as PinnedItem["type"],
		id: item.id,
		name,
		timestamp,
		...(isPositiveInteger(item.collectionId)
			? { collectionId: item.collectionId }
			: {}),
		...(typeof item.collectionName === "string"
			? { collectionName: item.collectionName }
			: {}),
		...(isPositiveInteger(item.classId) ? { classId: item.classId } : {}),
		...(typeof item.className === "string"
			? { className: item.className }
			: {}),
		...(type === "class" ? { action } : {}),
	};
}

export function getPinnedItems(): PinnedItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(PINNED_ITEMS_KEY);
		if (!stored) {
			return [];
		}

		const parsed = JSON.parse(stored);
		if (!Array.isArray(parsed)) {
			return [];
		}

		const items = parsed
			.map(normalizePinnedItem)
			.filter((item): item is PinnedItem => item !== null)
			.slice(0, MAX_PINNED_ITEMS);
		if (items.length !== parsed.length || JSON.stringify(items) !== stored) {
			writeUserSetting(PINNED_ITEMS_KEY, JSON.stringify(items));
		}
		return items;
	} catch {
		return [];
	}
}

export function pinItem(item: Omit<PinnedItem, "timestamp">): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		const existing = getPinnedItems();

		// Deduplication logic
		const isDuplicate = existing.some((existingItem) => {
			if (existingItem.type !== item.type || existingItem.id !== item.id) {
				return false;
			}
			// For classes, check action too (same class can be pinned twice with different actions)
			if (item.type === "class" && existingItem.type === "class") {
				return existingItem.action === item.action;
			}
			return true;
		});

		if (isDuplicate) {
			return false;
		}

		if (existing.length >= MAX_PINNED_ITEMS) {
			return false;
		}

		const newItem: PinnedItem = {
			...item,
			timestamp: Date.now(),
		};

		const updated = [newItem, ...existing];
		writeUserSetting(PINNED_ITEMS_KEY, JSON.stringify(updated));
		return true;
	} catch {
		return false;
	}
}

export function unpinItem(
	type: PinnedItemType,
	id: number,
	action?: ClassPinAction,
): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getPinnedItems();
		const filtered = existing.filter((item) => {
			if (item.type !== type || item.id !== id) {
				return true;
			}
			// For classes, match action too
			if (type === "class" && action !== undefined) {
				return item.action !== action;
			}
			return false;
		});

		writeUserSetting(PINNED_ITEMS_KEY, JSON.stringify(filtered));
	} catch {
		// Silently fail
	}
}

export function isPinned(
	type: PinnedItemType,
	id: number,
	action?: ClassPinAction,
): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const items = getPinnedItems();
	return items.some((item) => {
		if (item.type !== type || item.id !== id) {
			return false;
		}
		// For classes, check action too
		if (type === "class" && item.type === "class" && action !== undefined) {
			return item.action === action;
		}
		return true;
	});
}
