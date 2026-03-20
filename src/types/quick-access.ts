export type RecentItemType = "namespace" | "class" | "object";

export interface RecentItem {
	type: RecentItemType;
	id: number;
	name: string;
	timestamp: number;
	classId?: number;
	namespaceId?: number;
}

export interface PinnedClass {
	classId: number;
	className: string;
	namespaceName: string;
}

export type PinnedItemType = "namespace" | "class" | "object";
export type ClassPinAction = "view" | "create";

export interface PinnedItem {
	type: PinnedItemType;
	id: number; // namespace/class/object ID
	name: string; // entity name only (for display)
	timestamp: number; // when pinned

	// Type-specific fields (discriminated union pattern)
	namespaceId?: number; // for class and object pins
	namespaceName?: string; // for class and object pins (tooltip)
	classId?: number; // for object pins
	className?: string; // for object pins (tooltip)
	action?: ClassPinAction; // only for class pins
}
