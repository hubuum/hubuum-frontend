export type JsonFieldSource = "schema" | "sampled";

export type JsonFieldType =
	| "string"
	| "number"
	| "boolean"
	| "array"
	| "object"
	| "null"
	| "unknown";

export type DiscoveredJsonField = {
	path: string[];
	label: string;
	templateExpression: string;
	source: JsonFieldSource;
	types: JsonFieldType[];
	observedIn: number;
};

type DiscoveryOptions = {
	maxDepth?: number;
	maxFields?: number;
	maxSamples?: number;
	maxArrayItems?: number;
};

type MutableField = {
	path: string[];
	fromSchema: boolean;
	schemaTypes: Set<JsonFieldType>;
	sampleTypes: Set<JsonFieldType>;
	observedIn: number;
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FIELDS = 80;
const DEFAULT_MAX_SAMPLES = 100;
const DEFAULT_MAX_ARRAY_ITEMS = 16;
const MAX_PATHS_PER_DOCUMENT = 500;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ARRAY_INDEX = /^\[\d+\]$/;
export const JSON_ARRAY_ITEM_SEGMENT = "[#]";
const TYPE_ORDER: JsonFieldType[] = [
	"string",
	"number",
	"boolean",
	"array",
	"object",
	"null",
	"unknown",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function fieldId(path: string[]): string {
	return JSON.stringify(path);
}

function typeOfJsonValue(value: unknown): JsonFieldType {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (isRecord(value)) return "object";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "string";
	return "unknown";
}

function normalizeSchemaType(value: unknown): JsonFieldType | null {
	if (value === "integer" || value === "number") return "number";
	if (
		value === "string" ||
		value === "boolean" ||
		value === "array" ||
		value === "object" ||
		value === "null"
	) {
		return value;
	}
	return null;
}

function getSchemaTypes(schema: Record<string, unknown>): Set<JsonFieldType> {
	const rawTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
	const types = new Set<JsonFieldType>();
	for (const rawType of rawTypes) {
		const normalized = normalizeSchemaType(rawType);
		if (normalized) types.add(normalized);
	}
	if (!types.size) types.add("unknown");
	return types;
}

function getOrCreateField(
	fields: Map<string, MutableField>,
	path: string[],
): MutableField {
	const id = fieldId(path);
	const current = fields.get(id);
	if (current) return current;
	const field: MutableField = {
		path,
		fromSchema: false,
		schemaTypes: new Set(),
		sampleTypes: new Set(),
		observedIn: 0,
	};
	fields.set(id, field);
	return field;
}

function collectSchemaFields(
	schema: unknown,
	fields: Map<string, MutableField>,
	parentPath: string[],
	depth: number,
	maxDepth: number,
) {
	if (!isRecord(schema)) return;
	const properties = isRecord(schema.properties) ? schema.properties : null;
	if (!properties) return;

	for (const [key, propertySchema] of Object.entries(properties)) {
		const path = [...parentPath, key];
		if (!isRecord(propertySchema)) {
			const field = getOrCreateField(fields, path);
			field.fromSchema = true;
			field.schemaTypes.add("unknown");
			continue;
		}

		const propertyTypes = getSchemaTypes(propertySchema);
		const childProperties = isRecord(propertySchema.properties)
			? propertySchema.properties
			: null;
		const tupleItems = Array.isArray(propertySchema.prefixItems)
			? propertySchema.prefixItems
			: Array.isArray(propertySchema.items)
				? propertySchema.items
				: null;
		const commonItems = isRecord(propertySchema.items)
			? propertySchema.items
			: null;
		const isArray =
			propertyTypes.has("array") || tupleItems !== null || commonItems !== null;
		if (
			childProperties &&
			Object.keys(childProperties).length &&
			!isArray &&
			depth < maxDepth
		) {
			collectSchemaFields(propertySchema, fields, path, depth + 1, maxDepth);
			continue;
		}

		const field = getOrCreateField(fields, path);
		field.fromSchema = true;
		for (const type of propertyTypes) {
			field.schemaTypes.add(isArray && type === "unknown" ? "array" : type);
		}

		if (!isArray || depth >= maxDepth) continue;
		const itemSchemas: Array<{ segment: string; schema: unknown }> = tupleItems
			? tupleItems.map((itemSchema, index) => ({
					segment: `[${index}]`,
					schema: itemSchema,
				}))
			: commonItems
				? [{ segment: JSON_ARRAY_ITEM_SEGMENT, schema: commonItems }]
				: [];
		for (const item of itemSchemas) {
			const itemPath = [...path, item.segment];
			if (!isRecord(item.schema)) {
				const itemField = getOrCreateField(fields, itemPath);
				itemField.fromSchema = true;
				itemField.schemaTypes.add("unknown");
				continue;
			}
			const itemProperties = isRecord(item.schema.properties)
				? item.schema.properties
				: null;
			if (itemProperties && Object.keys(itemProperties).length) {
				collectSchemaFields(item.schema, fields, itemPath, depth + 1, maxDepth);
				continue;
			}
			const itemField = getOrCreateField(fields, itemPath);
			itemField.fromSchema = true;
			for (const type of getSchemaTypes(item.schema)) {
				itemField.schemaTypes.add(type);
			}
		}
	}
}

function recordSampleField(
	paths: Map<string, { path: string[]; types: Set<JsonFieldType> }>,
	path: string[],
	type: JsonFieldType,
) {
	const id = fieldId(path);
	const current = paths.get(id) ?? { path, types: new Set<JsonFieldType>() };
	current.types.add(type);
	paths.set(id, current);
}

function collectSampleValue(
	value: unknown,
	paths: Map<string, { path: string[]; types: Set<JsonFieldType> }>,
	path: string[],
	depth: number,
	maxDepth: number,
	maxArrayItems: number,
	budget: { remaining: number },
) {
	if (budget.remaining <= 0) return;
	budget.remaining -= 1;
	const type = typeOfJsonValue(value);

	if (type === "array") {
		recordSampleField(paths, path, "array");
		if (depth >= maxDepth) return;
		for (const [index, childValue] of (value as unknown[])
			.slice(0, maxArrayItems)
			.entries()) {
			collectSampleValue(
				childValue,
				paths,
				[...path, `[${index}]`],
				depth + 1,
				maxDepth,
				maxArrayItems,
				budget,
			);
		}
		return;
	}

	if (type === "object" && depth < maxDepth) {
		const childRecord = value as Record<string, unknown>;
		if (Object.keys(childRecord).length) {
			for (const [key, childValue] of Object.entries(childRecord)) {
				collectSampleValue(
					childValue,
					paths,
					[...path, key],
					depth + 1,
					maxDepth,
					maxArrayItems,
					budget,
				);
			}
			return;
		}
	}

	recordSampleField(paths, path, type);
}

function collectSampleFields(
	value: unknown,
	paths: Map<string, { path: string[]; types: Set<JsonFieldType> }>,
	maxDepth: number,
	maxArrayItems: number,
	budget: { remaining: number },
) {
	if (!isRecord(value)) return;
	for (const [key, childValue] of Object.entries(value)) {
		if (budget.remaining <= 0) return;
		collectSampleValue(
			childValue,
			paths,
			[key],
			1,
			maxDepth,
			maxArrayItems,
			budget,
		);
	}
}

function formatPath(path: string[]): string {
	return path
		.map((segment, index) => {
			if (segment === JSON_ARRAY_ITEM_SEGMENT) return "[]";
			if (ARRAY_INDEX.test(segment)) return segment;
			if (IDENTIFIER.test(segment))
				return `${index === 0 ? "" : "."}${segment}`;
			return `[${JSON.stringify(segment)}]`;
		})
		.join("");
}

export function toTemplateDataExpression(path: string[]): string {
	return `item.data${path
		.map((segment) => {
			if (segment === JSON_ARRAY_ITEM_SEGMENT) return "[0]";
			if (ARRAY_INDEX.test(segment)) return segment;
			return IDENTIFIER.test(segment)
				? `.${segment}`
				: `[${JSON.stringify(segment)}]`;
		})
		.join("")}`;
}

function orderedTypes(types: Set<JsonFieldType>): JsonFieldType[] {
	return TYPE_ORDER.filter((type) => types.has(type));
}

export function discoverJsonFields(
	jsonSchema: unknown,
	sampleData: unknown[],
	options: DiscoveryOptions = {},
): DiscoveredJsonField[] {
	const maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH);
	const maxFields = Math.max(1, options.maxFields ?? DEFAULT_MAX_FIELDS);
	const maxSamples = Math.max(0, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
	const maxArrayItems = Math.max(
		0,
		options.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS,
	);
	const fields = new Map<string, MutableField>();

	collectSchemaFields(jsonSchema, fields, [], 1, maxDepth);

	for (const sample of sampleData.slice(0, maxSamples)) {
		const sampleFields = new Map<
			string,
			{ path: string[]; types: Set<JsonFieldType> }
		>();
		collectSampleFields(sample, sampleFields, maxDepth, maxArrayItems, {
			remaining: MAX_PATHS_PER_DOCUMENT,
		});
		for (const { path, types } of sampleFields.values()) {
			const field = getOrCreateField(fields, path);
			field.observedIn += 1;
			for (const type of types) field.sampleTypes.add(type);
		}
	}

	return [...fields.values()]
		.sort((left, right) => {
			if (left.fromSchema !== right.fromSchema) return left.fromSchema ? -1 : 1;
			if (!left.fromSchema && left.observedIn !== right.observedIn) {
				return right.observedIn - left.observedIn;
			}
			return formatPath(left.path).localeCompare(
				formatPath(right.path),
				undefined,
				{
					numeric: true,
				},
			);
		})
		.slice(0, maxFields)
		.map((field) => {
			const schemaTypes = new Set(
				[...field.schemaTypes].filter((type) => type !== "unknown"),
			);
			const types = schemaTypes.size
				? schemaTypes
				: field.sampleTypes.size
					? field.sampleTypes
					: field.schemaTypes;
			return {
				path: field.path,
				label: formatPath(field.path),
				templateExpression: toTemplateDataExpression(field.path),
				source: field.fromSchema ? "schema" : "sampled",
				types: orderedTypes(types),
				observedIn: field.observedIn,
			};
		});
}
