import type { PinnedClass } from "@/types/quick-access";

const PINNED_CLASSES_KEY = "hubuum.pinned-classes";
const MAX_PINNED_CLASSES = 5;

export function getPinnedClasses(): PinnedClass[] {
	if (typeof window === "undefined") {
		return [];
	}

	try {
		const stored = window.localStorage.getItem(PINNED_CLASSES_KEY);
		if (!stored) {
			return [];
		}

		const items = JSON.parse(stored) as PinnedClass[];
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

export function pinClass(
	classId: number,
	className: string,
	namespaceName: string,
): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	try {
		const existing = getPinnedClasses();

		if (existing.some((item) => item.classId === classId)) {
			return false;
		}

		if (existing.length >= MAX_PINNED_CLASSES) {
			return false;
		}

		const updated: PinnedClass[] = [
			...existing,
			{ classId, className, namespaceName },
		];

		window.localStorage.setItem(PINNED_CLASSES_KEY, JSON.stringify(updated));
		return true;
	} catch {
		return false;
	}
}

export function unpinClass(classId: number): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const existing = getPinnedClasses();
		const filtered = existing.filter((item) => item.classId !== classId);

		window.localStorage.setItem(PINNED_CLASSES_KEY, JSON.stringify(filtered));
	} catch {
		// Silently fail
	}
}

export function isPinned(classId: number): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const pinned = getPinnedClasses();
	return pinned.some((item) => item.classId === classId);
}
