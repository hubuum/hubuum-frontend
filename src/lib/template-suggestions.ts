import type { Completion } from "@codemirror/autocomplete";

import type { ReportScopeKind } from "@/lib/api/reporting";
import { SCOPE_QUERY_FIELDS } from "@/lib/report-scope-fields";

export type FieldDef = { name: string; detail: string; nested?: "namespace" };

const BASE_OBJECT_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Entity id" },
	{ name: "name", detail: "Entity name" },
	{ name: "description", detail: "Entity description" },
	{ name: "created_at", detail: "Creation timestamp" },
	{ name: "updated_at", detail: "Update timestamp" },
];

// Fields present on object-bearing items (real Hubuum objects) and on
// hydrated relation entries.
const OBJECT_ITEM_FIELDS: FieldDef[] = [
	{ name: "namespace_id", detail: "Namespace id" },
	{ name: "hubuum_class_id", detail: "Class id" },
	{ name: "data", detail: "JSON data blob" },
];

export const NAMESPACE_FIELDS: FieldDef[] = [
	{ name: "id", detail: "Namespace id" },
	{ name: "name", detail: "Namespace name" },
];

const SCOPE_EXTRA_FIELDS: Partial<Record<ReportScopeKind, FieldDef[]>> = {
	classes: [
		{ name: "validate_schema", detail: "Whether this class validates object data" },
		{ name: "json_schema", detail: "JSON schema attached to this class" },
		{ name: "namespace", detail: "Owning namespace", nested: "namespace" },
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

type TemplateSuggestionDefinition = {
	label: string;
	detail: string;
	type: Completion["type"];
	section: string;
	boost?: number;
};

const ROOT_TEMPLATE_SUGGESTIONS: TemplateSuggestionDefinition[] = [
	{
		label: "items",
		detail: "Array of report rows",
		type: "variable",
		section: "Root",
	},
	{
		label: "meta.count",
		detail: "Number of rows in this result set",
		type: "property",
		section: "Meta",
	},
	{
		label: "meta.content_type",
		detail: "Response content type",
		type: "property",
		section: "Meta",
	},
	{
		label: "meta.truncated",
		detail: "Whether the report output was truncated",
		type: "property",
		section: "Meta",
	},
	{
		label: "meta.scope.kind",
		detail: "Report scope kind",
		type: "property",
		section: "Meta",
	},
	{
		label: "meta.scope.class_id",
		detail: "Class id for class-bound scopes",
		type: "property",
		section: "Meta",
	},
	{
		label: "meta.scope.object_id",
		detail: "Object id for object-bound scopes",
		type: "property",
		section: "Meta",
	},
	{
		label: "warnings",
		detail: "Warnings emitted while running the report",
		type: "variable",
		section: "Root",
	},
	{
		label: "for item in items",
		detail: "Loop over each row in the report",
		type: "keyword",
		section: "Control",
		boost: 1,
	},
	{
		label: "endfor",
		detail: "Close the current loop block",
		type: "keyword",
		section: "Control",
		boost: 1,
	},
];

const LOOP_COMMON_SUGGESTIONS: TemplateSuggestionDefinition[] = [
	{
		label: "item.id",
		detail: "Entity id",
		type: "property",
		section: "Entity",
	},
	{
		label: "item.name",
		detail: "Entity name",
		type: "property",
		section: "Entity",
	},
	{
		label: "item.description",
		detail: "Entity description",
		type: "property",
		section: "Entity",
	},
	{
		label: "item.created_at",
		detail: "Creation timestamp",
		type: "property",
		section: "Entity",
	},
	{
		label: "item.updated_at",
		detail: "Update timestamp",
		type: "property",
		section: "Entity",
	},
];

const RELATION_CONTEXT_SUGGESTIONS: TemplateSuggestionDefinition[] = [
	{
		label: "item.related",
		detail: "Adjacent objects grouped by relation alias",
		type: "property",
		section: "Relations",
		boost: 4,
	},
	{
		label: "item.reachable",
		detail: "Flattened reachable objects grouped by class alias",
		type: "property",
		section: "Relations",
		boost: 4,
	},
	{
		label: "item.paths",
		detail: "Path-preserving reachable objects grouped by class alias",
		type: "property",
		section: "Relations",
		boost: 4,
	},
	{
		label: "item.path_objects",
		detail: "Objects along the traversal path",
		type: "property",
		section: "Relations",
		boost: 4,
	},
];

const MANUAL_SCOPE_EXTRAS: Partial<
	Record<ReportScopeKind, TemplateSuggestionDefinition[]>
> = {
	classes: [
		{
			label: "item.validate_schema",
			detail: "Whether this class validates object data",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.json_schema",
			detail: "JSON schema attached to this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.namespace.id",
			detail: "Namespace id for this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.namespace.name",
			detail: "Namespace name for this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	objects_in_class: [
		{
			label: "item.namespace_id",
			detail: "Namespace id for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.hubuum_class_id",
			detail: "Class id for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.data",
			detail: "JSON data blob for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	class_relations: [
		{
			label: "item.from_hubuum_class_id",
			detail: "Source class id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.to_hubuum_class_id",
			detail: "Target class id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	object_relations: [
		{
			label: "item.class_relation_id",
			detail: "Class relation id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.from_hubuum_object_id",
			detail: "Source object id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.to_hubuum_object_id",
			detail: "Target object id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	related_objects: [
		{
			label: "item.namespace_id",
			detail: "Namespace id for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.hubuum_class_id",
			detail: "Class id for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.data",
			detail: "JSON data blob for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "item.path",
			detail: "Traversal path for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
};

const SCOPE_QUERY_FIELD_ALIASES: Partial<
	Record<ReportScopeKind, Record<string, string>>
> = {
	objects_in_class: {
		class_id: "hubuum_class_id",
		json_data: "data",
	},
	class_relations: {
		from_classes: "from_hubuum_class_id",
		to_classes: "to_hubuum_class_id",
	},
	object_relations: {
		class_relation: "class_relation_id",
		from_objects: "from_hubuum_object_id",
		to_objects: "to_hubuum_object_id",
	},
	related_objects: {
		class_id: "hubuum_class_id",
	},
};

function humanizeFieldName(value: string) {
	return value
		.replaceAll(".", " ")
		.replaceAll("_", " ")
		.replace(/\b\w/g, (match) => match.toUpperCase());
}

function mapScopeFieldToTemplatePath(
	scopeKind: ReportScopeKind,
	key: string,
): string | null {
	const alias = SCOPE_QUERY_FIELD_ALIASES[scopeKind]?.[key] ?? key;
	if (alias === "permissions" || alias === "namespaces" || alias === "classes") {
		return null;
	}

	return `item.${alias}`;
}

function dedupeSuggestions(suggestions: TemplateSuggestionDefinition[]) {
	const seen = new Set<string>();
	return suggestions.filter((suggestion) => {
		if (seen.has(suggestion.label)) {
			return false;
		}
		seen.add(suggestion.label);
		return true;
	});
}

function getScopeSuggestions(scopeKind?: ReportScopeKind) {
	if (!scopeKind) {
		return [];
	}

	const manualSuggestions = MANUAL_SCOPE_EXTRAS[scopeKind] ?? [];
	const derivedSuggestions = SCOPE_QUERY_FIELDS[scopeKind]
		.map((field) => {
			const mappedPath = mapScopeFieldToTemplatePath(scopeKind, field.key);
			if (!mappedPath) {
				return null;
			}

			return {
				label: mappedPath,
				detail: humanizeFieldName(field.key),
				type: "property" as const,
				section: "Scope",
				boost: 3,
			};
		})
		.filter(
			(
				field,
			): field is {
				label: string;
				detail: string;
				type: "property";
				section: string;
				boost: number;
			} => field !== null,
		);

	return dedupeSuggestions([...manualSuggestions, ...derivedSuggestions]);
}

function toCompletion(
	suggestion: TemplateSuggestionDefinition,
): Completion {
	return {
		label: suggestion.label,
		detail: suggestion.detail,
		type: suggestion.type,
		section: suggestion.section,
		boost: suggestion.boost,
	};
}

function propertyCompletion(
	label: string,
	detail: string,
	section = "Properties",
	boost?: number,
): Completion {
	return {
		label,
		detail,
		type: "property",
		section,
		boost,
	};
}

function stripPathPrefix(label: string, prefix: string): Completion | null {
	if (!label.startsWith(`${prefix}.`)) {
		return null;
	}

	const remainder = label.slice(prefix.length + 1);
	const property = remainder.split(".")[0];
	if (!property) {
		return null;
	}

	return propertyCompletion(property, label, "Hubuum", 3);
}

function uniqueCompletions(completions: readonly Completion[]): Completion[] {
	const seen = new Set<string>();
	return completions.filter((completion) => {
		if (seen.has(completion.label)) {
			return false;
		}
		seen.add(completion.label);
		return true;
	});
}

export function getJinjaTags(): Completion[] {
	return [
		{
			label: "for item in items",
			detail: "Loop over report rows",
			type: "keyword",
			boost: 4,
		},
		{
			label: "if",
			detail: "Start a conditional block",
			type: "keyword",
		},
		{
			label: "else",
			detail: "Conditional fallback branch",
			type: "keyword",
		},
		{
			label: "endif",
			detail: "Close a conditional block",
			type: "keyword",
		},
		{
			label: "endfor",
			detail: "Close a loop block",
			type: "keyword",
		},
		{
			label: "set",
			detail: "Assign a template variable",
			type: "keyword",
		},
		{
			label: "include",
			detail: "Include a template from the same namespace",
			type: "keyword",
		},
		{
			label: "import",
			detail: "Import macros from a same-namespace template",
			type: "keyword",
		},
		{
			label: "extends",
			detail: "Extend a same-namespace template",
			type: "keyword",
		},
	];
}

export function getJinjaVariables(): Completion[] {
	return [
		{
			label: "items",
			detail: "Array of report rows",
			type: "variable",
			boost: 4,
		},
		{
			label: "item",
			detail: "Current report row inside item loops",
			type: "variable",
			boost: 3,
		},
		{
			label: "meta",
			detail: "Report metadata",
			type: "variable",
			boost: 3,
		},
		{
			label: "warnings",
			detail: "Report warnings",
			type: "variable",
		},
		{
			label: "request",
			detail: "Report request context",
			type: "variable",
		},
		{
			label: "source",
			detail: "Hydrated root object for related-object template reports",
			type: "variable",
		},
	];
}

export function getJinjaProperties(
	path: readonly string[],
	scopeKind?: ReportScopeKind,
): Completion[] {
	const [root, ...rest] = path;

	if (root === "meta") {
		if (rest.length === 0) {
			return [
				propertyCompletion("count", "Number of rows", "Meta"),
				propertyCompletion("content_type", "Output content type", "Meta"),
				propertyCompletion("truncated", "Whether the result was truncated", "Meta"),
				propertyCompletion("scope", "Report scope", "Meta"),
			];
		}
		if (rest[0] === "scope" && rest.length === 1) {
			return [
				propertyCompletion("kind", "Report scope kind", "Meta"),
				propertyCompletion("class_id", "Class id for class-bound scopes", "Meta"),
				propertyCompletion("object_id", "Object id for object-bound scopes", "Meta"),
			];
		}
	}

	if (root === "request") {
		if (rest.length === 0) {
			return [
				propertyCompletion("scope", "Submitted report scope", "Request"),
				propertyCompletion("query", "Submitted query string", "Request"),
			];
		}
		if (rest[0] === "scope" && rest.length === 1) {
			return [
				propertyCompletion("kind", "Report scope kind", "Request"),
				propertyCompletion("class_id", "Class id for class-bound scopes", "Request"),
				propertyCompletion("object_id", "Object id for object-bound scopes", "Request"),
			];
		}
	}

	if ((root === "item" || root === "source") && rest.length === 0) {
		const scopeCompletions = getTemplateSuggestions(scopeKind, true)
			.map((suggestion) => stripPathPrefix(suggestion.label, "item"))
			.filter((completion): completion is Completion => completion !== null);

		return uniqueCompletions([
			...scopeCompletions,
			propertyCompletion("related", "Adjacent objects grouped by relation alias", "Relations", 4),
			propertyCompletion("reachable", "Flattened reachable objects grouped by class alias", "Relations", 4),
			propertyCompletion("paths", "Path-preserving reachable objects grouped by class alias", "Relations", 4),
			propertyCompletion("path_objects", "Objects along the traversal path", "Relations", 4),
		]);
	}

	return [];
}

export function getTemplateSuggestions(
	scopeKind: ReportScopeKind | undefined,
	insideLoop: boolean,
): Completion[] {
	if (insideLoop) {
		return dedupeSuggestions([
			...getScopeSuggestions(scopeKind),
			...LOOP_COMMON_SUGGESTIONS,
			...RELATION_CONTEXT_SUGGESTIONS,
		]).map(toCompletion);
	}

	return ROOT_TEMPLATE_SUGGESTIONS.map(toCompletion);
}

export function getValidTemplatePaths(
	scopeKind: ReportScopeKind | undefined,
	insideLoop: boolean,
): Set<string> {
	return new Set(
		getTemplateSuggestions(scopeKind, insideLoop).map(
			(suggestion) => suggestion.label,
		),
	);
}

export function validateTemplateExpression(
	expression: string,
	scopeKind: ReportScopeKind | undefined,
	insideLoop: boolean,
) {
	const trimmedExpression = expression.trim();
	if (!trimmedExpression) {
		return null;
	}

	if (trimmedExpression === "endfor") {
		return null;
	}

	if (trimmedExpression.startsWith("for")) {
		const loopMatch = trimmedExpression.match(/^for\s+\w+\s+in\s+(.+)$/);
		if (!loopMatch) {
			return {
				path: trimmedExpression,
				message: "Loop expressions must use `for item in collection`.",
			};
		}
		const loopPath = loopMatch[1].trim();

		if (getValidTemplatePaths(scopeKind, false).has(loopPath)) {
			return null;
		}

		return {
			path: loopPath,
			message: `\`${loopPath}\` is not a valid loop source for the current report scope.`,
		};
	}

	if (/^[A-Za-z_][\w.]*(?:\s+[A-Za-z_][\w.]*)+$/.test(trimmedExpression)) {
		return null;
	}

	if (!/^[A-Za-z_][\w.]*$/.test(trimmedExpression)) {
		return null;
	}

	if (getValidTemplatePaths(scopeKind, insideLoop).has(trimmedExpression)) {
		return null;
	}

	const validPrefixes = [...getValidTemplatePaths(scopeKind, insideLoop)];
	if (
		validPrefixes.some(
			(path) =>
				trimmedExpression.startsWith(`${path}.`) ||
				trimmedExpression.startsWith(`${path}[`),
		)
	) {
		return null;
	}

	return {
		path: trimmedExpression,
		message: `\`${trimmedExpression}\` is not available for the current report scope.`,
	};
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
