import type { PinnedClass } from "@/types/quick-access";
import type { PinnedItem, PinnedItemType, ClassPinAction } from "@/types/quick-access";

const PINNED_ITEMS_KEY = "hubuum.pinned-items";
const PINNED_CLASSES_KEY = "hubuum.pinned-classes"; // old key for migration
const MAX_PINNED_ITEMS = 10;

// Migration: Convert old PinnedClass[] to new PinnedItem[]
function migrateOldPinnedClasses(): PinnedItem[] | null {
	if (typeof window === "undefined") {
		return null;
	}

	try {
		const oldData = window.localStorage.getItem(PINNED_CLASSES_KEY);
		if (!oldData) {
			return null;
		}

		const oldClasses = JSON.parse(oldData) as PinnedClass[];
		if (!Array.isArray(oldClasses)) {
			return null;
		}

		const migrated: PinnedItem[] = oldClasses.map((old) => ({
			type: "class" as const,
			id: old.classId,
			name: old.className,
			timestamp: Date.now(),
			namespaceId: undefined,
			namespaceName: old.namespaceName,
			action: "create" as const, // preserve current behavior
		}));

		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(migrated));
		window.localStorage.removeItem(PINNED_CLASSES_KEY);

		return migrated;
	} catch {
		return null;
	}
}

export function getPinnedItems(): PinnedItem[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(PINNED_ITEMS_KEY);
		if (!stored) {
			const migrated = migrateOldPinnedClasses();
			return migrated ?? [];
		}

		const items = JSON.parse(stored) as PinnedItem[];
		return Array.isArray(items) ? items : [];
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
			if (item.type === "class") {
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
		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(updated));
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

		window.localStorage.setItem(PINNED_ITEMS_KEY, JSON.stringify(filtered));
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
		if (type === "class" && action !== undefined) {
			return item.action === action;
		}
		return true;
	});
}
