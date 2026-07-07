export type RecentItemType =
	| "collection"
	| "class"
	| "object"
	| "task"
	| "admin-user"
	| "admin-group"
	| "service-account";

export interface RecentItem {
	type: RecentItemType;
	id: number;
	name: string;
	timestamp: number;
	classId?: number;
	collectionId?: number;
}

export type PinnedItemType = "collection" | "class" | "object";
export type ClassPinAction = "view" | "create";

export interface PinnedItem {
	type: PinnedItemType;
	id: number; // collection/class/object ID
	name: string; // entity name only (for display)
	timestamp: number; // when pinned

	// Type-specific fields (discriminated union pattern)
	collectionId?: number; // for class and object pins
	collectionName?: string; // for class and object pins (tooltip)
	classId?: number; // for object pins
	className?: string; // for object pins (tooltip)
	action?: ClassPinAction; // only for class pins
}
