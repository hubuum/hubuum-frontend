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

export const OPEN_CREATE_EVENT = "hubuum:open-create";
export const SELECTION_STATE_EVENT = "hubuum:selection-state";
export const DESELECT_ALL_EVENT = "hubuum:deselect-all";
export const SELECT_ALL_EVENT = "hubuum:select-all";
