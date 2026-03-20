import type { ReportScopeKind } from "@/lib/api/reporting";

export type QueryFieldKind =
	| "string"
	| "number"
	| "date"
	| "boolean"
	| "array"
	| "json";

export type QueryFieldDefinition = {
	key: string;
	kind: QueryFieldKind;
	sortable: boolean;
};

export const SCOPE_QUERY_FIELDS: Record<ReportScopeKind, QueryFieldDefinition[]> = {
	namespaces: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "name", kind: "string", sortable: true },
		{ key: "description", kind: "string", sortable: false },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "permissions", kind: "array", sortable: false },
	],
	classes: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "namespaces", kind: "number", sortable: true },
		{ key: "namespace_id", kind: "number", sortable: true },
		{ key: "name", kind: "string", sortable: true },
		{ key: "description", kind: "string", sortable: false },
		{ key: "validate_schema", kind: "boolean", sortable: false },
		{ key: "json_schema", kind: "json", sortable: false },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "permissions", kind: "array", sortable: false },
	],
	objects_in_class: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "name", kind: "string", sortable: true },
		{ key: "description", kind: "string", sortable: false },
		{ key: "namespaces", kind: "number", sortable: true },
		{ key: "namespace_id", kind: "number", sortable: true },
		{ key: "classes", kind: "number", sortable: true },
		{ key: "class_id", kind: "number", sortable: true },
		{ key: "json_data", kind: "json", sortable: false },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "permissions", kind: "array", sortable: false },
	],
	class_relations: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "from_classes", kind: "number", sortable: true },
		{ key: "to_classes", kind: "number", sortable: true },
		{ key: "from_class_name", kind: "string", sortable: false },
		{ key: "to_class_name", kind: "string", sortable: false },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "permissions", kind: "array", sortable: false },
	],
	object_relations: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "class_relation", kind: "number", sortable: true },
		{ key: "from_objects", kind: "number", sortable: true },
		{ key: "to_objects", kind: "number", sortable: true },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "permissions", kind: "array", sortable: false },
	],
	related_objects: [
		{ key: "id", kind: "number", sortable: true },
		{ key: "name", kind: "string", sortable: true },
		{ key: "description", kind: "string", sortable: true },
		{ key: "namespace_id", kind: "number", sortable: true },
		{ key: "namespaces", kind: "number", sortable: true },
		{ key: "class_id", kind: "number", sortable: true },
		{ key: "classes", kind: "number", sortable: true },
		{ key: "created_at", kind: "date", sortable: true },
		{ key: "updated_at", kind: "date", sortable: true },
		{ key: "from_objects", kind: "number", sortable: true },
		{ key: "to_objects", kind: "number", sortable: true },
		{ key: "from_classes", kind: "number", sortable: true },
		{ key: "to_classes", kind: "number", sortable: true },
		{ key: "from_namespaces", kind: "number", sortable: true },
		{ key: "to_namespaces", kind: "number", sortable: true },
		{ key: "from_name", kind: "string", sortable: true },
		{ key: "to_name", kind: "string", sortable: true },
		{ key: "from_description", kind: "string", sortable: true },
		{ key: "to_description", kind: "string", sortable: true },
		{ key: "from_created_at", kind: "date", sortable: true },
		{ key: "to_created_at", kind: "date", sortable: true },
		{ key: "from_updated_at", kind: "date", sortable: true },
		{ key: "to_updated_at", kind: "date", sortable: true },
		{ key: "from_json_data", kind: "json", sortable: false },
		{ key: "to_json_data", kind: "json", sortable: false },
		{ key: "depth", kind: "number", sortable: true },
		{ key: "path", kind: "array", sortable: true },
	],
};
