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
