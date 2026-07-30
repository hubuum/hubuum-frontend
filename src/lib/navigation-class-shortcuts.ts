import type { PinnedItem, RecentItem } from "@/types/quick-access";

export type NavigationClassShortcut = {
	id: number;
	name: string;
};

type BuildNavigationClassShortcutsOptions = {
	fallbackClasses: readonly NavigationClassShortcut[];
	limit: number;
	pinnedItems: readonly PinnedItem[];
	recentItems: readonly RecentItem[];
};

export function buildNavigationClassShortcuts({
	fallbackClasses,
	limit,
	pinnedItems,
	recentItems,
}: BuildNavigationClassShortcutsOptions): NavigationClassShortcut[] {
	const shortcuts = new Map<number, NavigationClassShortcut>();
	const addShortcut = (shortcut: NavigationClassShortcut) => {
		if (shortcuts.size >= limit || shortcuts.has(shortcut.id)) {
			return;
		}
		shortcuts.set(shortcut.id, shortcut);
	};

	for (const item of pinnedItems) {
		if (item.type === "class") {
			addShortcut({ id: item.id, name: item.name });
		} else if (item.type === "object" && item.classId && item.className) {
			addShortcut({ id: item.classId, name: item.className });
		}
	}
	for (const item of recentItems) {
		if (item.type === "class") {
			addShortcut({ id: item.id, name: item.name });
		}
	}
	for (const item of fallbackClasses) {
		addShortcut(item);
	}

	return [...shortcuts.values()];
}
