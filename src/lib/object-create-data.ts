import {
	discoverJsonFields,
	type JsonFieldType,
} from "@/lib/json-field-discovery";
import type { ObjectDataFieldType } from "@/lib/object-data-editing";

export type ObjectCreateDataField = {
	id: string;
	initialValue: unknown;
	label: string;
	path: string[];
	required: boolean;
	source: "schema" | "sampled";
	types: ObjectDataFieldType[];
};

export type ObjectCreateDataModel = {
	allowsNewFields: boolean;
	fields: ObjectCreateDataField[];
	initialData: Record<string, unknown>;
};

const ARRAY_PATH_SEGMENT = /^\[(?:#|\d+)]$/;
const FIELD_TYPE_ORDER: ObjectDataFieldType[] = [
	"string",
	"number",
	"boolean",
	"null",
	"object",
	"array",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneJsonValue);
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
		);
	}
	return value;
}

function schemaTypes(schema: unknown): ObjectDataFieldType[] {
	if (!isRecord(schema)) return [];
	const rawTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
	const types = new Set<ObjectDataFieldType>();
	for (const rawType of rawTypes) {
		if (rawType === "integer" || rawType === "number") {
			types.add("number");
		} else if (
			rawType === "string" ||
			rawType === "boolean" ||
			rawType === "null" ||
			rawType === "object" ||
			rawType === "array"
		) {
			types.add(rawType);
		}
	}
	if (!types.size && isRecord(schema.properties)) types.add("object");
	if (!types.size && schema.items !== undefined) types.add("array");
	return FIELD_TYPE_ORDER.filter((type) => types.has(type));
}

function normalizeDiscoveredTypes(
	types: JsonFieldType[],
): ObjectDataFieldType[] {
	const normalized = new Set<ObjectDataFieldType>();
	for (const type of types) {
		if (type === "unknown") continue;
		normalized.add(type);
	}
	return FIELD_TYPE_ORDER.filter((type) => normalized.has(type));
}

function schemaNodeAtPath(schema: unknown, path: string[]): unknown {
	let current: unknown = schema;
	for (const segment of path) {
		if (!isRecord(current) || !isRecord(current.properties)) return undefined;
		current = current.properties[segment];
	}
	return current;
}

function isRequiredSchemaPath(schema: unknown, path: string[]): boolean {
	let current = schema;
	for (const segment of path) {
		if (!isRecord(current) || !isRecord(current.properties)) return false;
		const required = Array.isArray(current.required)
			? current.required.filter(
					(candidate): candidate is string => typeof candidate === "string",
				)
			: [];
		if (!required.includes(segment)) return false;
		current = current.properties[segment];
	}
	return path.length > 0;
}

function initialValueForSchema(schema: unknown): unknown {
	if (!isRecord(schema)) return "";
	if (schema.default !== undefined) return cloneJsonValue(schema.default);
	if (schema.const !== undefined) return cloneJsonValue(schema.const);
	if (Array.isArray(schema.enum) && schema.enum.length > 0) {
		return cloneJsonValue(schema.enum[0]);
	}

	const types = schemaTypes(schema);
	const type = types[0] ?? "string";
	if (type === "object") {
		const properties = isRecord(schema.properties) ? schema.properties : {};
		const required = Array.isArray(schema.required)
			? schema.required.filter(
					(candidate): candidate is string => typeof candidate === "string",
				)
			: [];
		return Object.fromEntries(
			required
				.filter((key) => Object.hasOwn(properties, key))
				.map((key) => [key, initialValueForSchema(properties[key])]),
		);
	}
	if (type === "array") return [];
	if (type === "number") return 0;
	if (type === "boolean") return false;
	if (type === "null") return null;
	return "";
}

function initialValueForTypes(types: ObjectDataFieldType[]): unknown {
	const type = types[0] ?? "string";
	if (type === "array") return [];
	if (type === "object") return {};
	if (type === "number") return 0;
	if (type === "boolean") return false;
	if (type === "null") return null;
	return "";
}

function schemaAllowsAdditionalAtNode(schema: unknown): boolean {
	if (schema === false) return false;
	if (!isRecord(schema)) return true;
	const rawTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
	const declaredTypes = rawTypes.filter(
		(candidate): candidate is string => typeof candidate === "string",
	);
	if (declaredTypes.length > 0 && !declaredTypes.includes("object")) {
		return false;
	}
	return (
		schema.additionalProperties !== false &&
		schema.unevaluatedProperties !== false
	);
}

function schemaAllowsAnyAdditionalField(
	schema: unknown,
	visited = new Set<unknown>(),
): boolean {
	if (schema === false) return false;
	if (!isRecord(schema)) return true;
	if (visited.has(schema)) return false;
	visited.add(schema);
	const rawTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
	const declaredTypes = rawTypes.filter(
		(candidate): candidate is string => typeof candidate === "string",
	);
	if (declaredTypes.length > 0 && !declaredTypes.includes("object")) {
		return false;
	}
	if (schemaAllowsAdditionalAtNode(schema)) return true;
	if (!isRecord(schema.properties)) return false;
	return Object.values(schema.properties).some((propertySchema) =>
		schemaAllowsAnyAdditionalField(propertySchema, visited),
	);
}

export function isObjectCreatePathAllowed(
	schema: unknown,
	path: readonly string[],
): boolean {
	if (schema === undefined || schema === null) return true;
	let current: unknown = schema;
	for (const segment of path) {
		if (current === false) return false;
		if (!isRecord(current)) return true;
		const properties = isRecord(current.properties)
			? current.properties
			: null;
		if (properties && Object.hasOwn(properties, segment)) {
			current = properties[segment];
			continue;
		}
		if (!schemaAllowsAdditionalAtNode(current)) return false;
		current = isRecord(current.additionalProperties)
			? current.additionalProperties
			: undefined;
	}
	return current !== false;
}

export function buildObjectCreateDataModel(
	schema: unknown,
	sampleData: unknown[],
): ObjectCreateDataModel {
	const hasSchema = schema !== undefined && schema !== null;
	const fields = discoverJsonFields(schema, sampleData)
		.filter(
			(field) => !field.path.some((segment) => ARRAY_PATH_SEGMENT.test(segment)),
		)
		.filter(
			(field) =>
				field.source === "schema" ||
				!hasSchema ||
				isObjectCreatePathAllowed(schema, field.path),
		)
		.map<ObjectCreateDataField>((field) => {
			const fieldSchema = schemaNodeAtPath(schema, field.path);
			const discoveredTypes = normalizeDiscoveredTypes(field.types);
			const types = schemaTypes(fieldSchema);
			const resolvedTypes = types.length ? types : discoveredTypes;
			return {
				id: JSON.stringify(field.path),
				initialValue:
					field.source === "schema"
						? initialValueForSchema(fieldSchema)
						: initialValueForTypes(resolvedTypes),
				label: field.label,
				path: field.path,
				required:
					field.source === "schema" &&
					isRequiredSchemaPath(schema, field.path),
				source: field.source,
				types: resolvedTypes.length ? resolvedTypes : ["string"],
			};
		});

	const initial = initialValueForSchema(schema);
	return {
		allowsNewFields:
			!hasSchema || schemaAllowsAnyAdditionalField(schema),
		fields,
		initialData: isRecord(initial) ? initial : {},
	};
}

export function removeObjectCreateDataValue(
	root: unknown,
	path: readonly string[],
): unknown {
	if (!path.length || !isRecord(root)) return root;
	const [segment, ...rest] = path;
	if (!Object.hasOwn(root, segment)) return root;
	const next = { ...root };
	if (!rest.length) {
		delete next[segment];
		return next;
	}
	next[segment] = removeObjectCreateDataValue(root[segment], rest);
	return next;
}
