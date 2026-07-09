import type { ReportScopeKind } from "@/lib/api/reporting";

export type FieldDef = { name: string; detail: string; nested?: "collection" };

const BASE_OBJECT_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Entity id" },
	{ name: "name", detail: "Entity name" },
	{ name: "description", detail: "Entity description" },
	{ name: "created_at", detail: "Creation timestamp" },
	{ name: "updated_at", detail: "Update timestamp" },
];

const OBJECT_ITEM_FIELDS: FieldDef[] = [
	{ name: "collection_id", detail: "Collection id" },
	{ name: "hubuum_class_id", detail: "Class id" },
	{ name: "data", detail: "JSON data blob" },
];

export const NAMESPACE_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Collection id" },
	{ name: "name", detail: "Collection name" },
];

const SCOPE_EXTRA_FIELDS: Partial<Record<ReportScopeKind, FieldDef[]>> = {
	classes: [
		{ name: "validate_schema", detail: "Whether this class validates object data" },
		{ name: "json_schema", detail: "JSON schema attached to this class" },
		{ name: "collection", detail: "Owning collection", nested: "collection" },
	],
	objects_in_class: OBJECT_ITEM_FIELDS,
	class_relations: [
		{ name: "from_hubuum_class_id", detail: "Source class id" },
		{ name: "to_hubuum_class_id", detail: "Target class id" },
	],
	object_relations: [
		{ name: "class_relation_id", detail: "Class relation id" },
		{ name: "from_hubuum_object_id", detail: "Source object id" },
		{ name: "to_hubuum_object_id", detail: "Target object id" },
	],
	related_objects: [...OBJECT_ITEM_FIELDS, { name: "path", detail: "Traversal path (id list)" }],
};

export function getScopeObjectFields(scopeKind?: ReportScopeKind): FieldDef[] {
	if (!scopeKind) {
		return BASE_OBJECT_FIELDS;
	}
	const extras = SCOPE_EXTRA_FIELDS[scopeKind] ?? [];
	const seen = new Set<string>();
	return [...BASE_OBJECT_FIELDS, ...extras].filter((field) => {
		if (seen.has(field.name)) {
			return false;
		}
		seen.add(field.name);
		return true;
	});
}

export function analyzeTemplate(value: string) {
	const openEach = (value.match(/\{%\s*for\s+[^%]+%\}/g) ?? []).length;
	const closeEach = (value.match(/\{%\s*endfor\s*%\}/g) ?? []).length;
	const expressionMatches = value.match(/\{\{([^}]+)\}\}/g) ?? [];
	const expressions = Array.from(
		new Set(
			expressionMatches
				.map((match) => match.replaceAll("{", "").replaceAll("}", "").trim())
				.filter((match) => match !== "endfor" && !match.startsWith("for")),
		),
	);

	return {
		openEach,
		closeEach,
		expressions,
	};
}
