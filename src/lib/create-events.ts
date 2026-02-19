export type CreateSection = "namespaces" | "classes" | "objects" | "relations";

export type OpenCreateEventDetail = {
  section: CreateSection;
};

export const OPEN_CREATE_EVENT = "hubuum:open-create";
