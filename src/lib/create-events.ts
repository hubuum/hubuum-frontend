export type CreateSection =
	| "namespaces"
	| "classes"
	| "objects"
	| "relations"
	| "admin-users"
	| "admin-groups";

export type OpenCreateEventDetail = {
	section: CreateSection;
};

export type SelectionStateEventDetail = {
	count: number;
	deleteHandler: (() => void) | null;
};

export type EditStateEventDetail = {
	label: string;
	editHandler: (() => void) | null;
};

export type TitleStateEventDetail = {
	title: string | null;
	pin:
		| {
				type: "namespace";
				id: number;
				name: string;
		  }
		| {
				type: "class";
				id: number;
				name: string;
				namespaceId: number;
				namespaceName: string;
		  }
		| {
				type: "object";
				id: number;
				name: string;
				namespaceId: number;
				namespaceName: string;
				classId: number;
				className?: string;
		  }
		| null;
};

export const OPEN_CREATE_EVENT = "hubuum:open-create";
export const SELECTION_STATE_EVENT = "hubuum:selection-state";
export const EDIT_STATE_EVENT = "hubuum:edit-state";
export const TITLE_STATE_EVENT = "hubuum:title-state";
export const DESELECT_ALL_EVENT = "hubuum:deselect-all";
export const SELECT_ALL_EVENT = "hubuum:select-all";
