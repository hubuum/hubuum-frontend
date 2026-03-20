import type { Completion } from "@codemirror/autocomplete";

import type { ReportScopeKind } from "@/lib/api/reporting";
import { SCOPE_QUERY_FIELDS } from "@/lib/report-scope-fields";

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
		label: "#each items",
		detail: "Loop over each row in the report",
		type: "keyword",
		section: "Control",
		boost: 1,
	},
	{
		label: "/each",
		detail: "Close the current loop block",
		type: "keyword",
		section: "Control",
		boost: 1,
	},
];

const LOOP_COMMON_SUGGESTIONS: TemplateSuggestionDefinition[] = [
	{
		label: "this.id",
		detail: "Entity id",
		type: "property",
		section: "Entity",
	},
	{
		label: "this.name",
		detail: "Entity name",
		type: "property",
		section: "Entity",
	},
	{
		label: "this.description",
		detail: "Entity description",
		type: "property",
		section: "Entity",
	},
	{
		label: "this.created_at",
		detail: "Creation timestamp",
		type: "property",
		section: "Entity",
	},
	{
		label: "this.updated_at",
		detail: "Update timestamp",
		type: "property",
		section: "Entity",
	},
];

const MANUAL_SCOPE_EXTRAS: Partial<
	Record<ReportScopeKind, TemplateSuggestionDefinition[]>
> = {
	classes: [
		{
			label: "this.validate_schema",
			detail: "Whether this class validates object data",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.json_schema",
			detail: "JSON schema attached to this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.namespace.id",
			detail: "Namespace id for this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.namespace.name",
			detail: "Namespace name for this class",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	objects_in_class: [
		{
			label: "this.namespace_id",
			detail: "Namespace id for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.hubuum_class_id",
			detail: "Class id for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.data",
			detail: "JSON data blob for this object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	class_relations: [
		{
			label: "this.from_hubuum_class_id",
			detail: "Source class id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.to_hubuum_class_id",
			detail: "Target class id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	object_relations: [
		{
			label: "this.class_relation_id",
			detail: "Class relation id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.from_hubuum_object_id",
			detail: "Source object id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.to_hubuum_object_id",
			detail: "Target object id",
			type: "property",
			section: "Scope",
			boost: 4,
		},
	],
	related_objects: [
		{
			label: "this.namespace_id",
			detail: "Namespace id for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.hubuum_class_id",
			detail: "Class id for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.data",
			detail: "JSON data blob for this related object",
			type: "property",
			section: "Scope",
			boost: 4,
		},
		{
			label: "this.path",
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

	return `this.${alias}`;
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

export function getTemplateSuggestions(
	scopeKind: ReportScopeKind | undefined,
	insideLoop: boolean,
): Completion[] {
	if (insideLoop) {
		return dedupeSuggestions([
			...getScopeSuggestions(scopeKind),
			...LOOP_COMMON_SUGGESTIONS,
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

	if (trimmedExpression === "/each") {
		return null;
	}

	if (trimmedExpression.startsWith("#each")) {
		const loopPath = trimmedExpression.slice(5).trim();
		if (!loopPath) {
			return {
				path: trimmedExpression,
				message: "Loop expressions must include a collection path.",
			};
		}

		if (getValidTemplatePaths(scopeKind, false).has(`#each ${loopPath}`)) {
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

	return {
		path: trimmedExpression,
		message: `\`${trimmedExpression}\` is not available for the current report scope.`,
	};
}

export function analyzeTemplate(value: string) {
	const openEach = (value.match(/\{\{#each\s+[^}]+\}\}/g) ?? []).length;
	const closeEach = (value.match(/\{\{\/each\}\}/g) ?? []).length;
	const expressionMatches = value.match(/\{\{([^}]+)\}\}/g) ?? [];
	const expressions = Array.from(
		new Set(
			expressionMatches
				.map((match) => match.replaceAll("{", "").replaceAll("}", "").trim())
				.filter((match) => match !== "/each" && !match.startsWith("#each")),
		),
	);

	return {
		openEach,
		closeEach,
		expressions,
	};
}
