export type JsonSyntaxErrorDetails = {
  message: string;
  position: number | null;
  line: number | null;
  column: number | null;
};

export type ParsedJsonResult =
  | { kind: "empty" }
  | { kind: "success"; value: unknown }
  | { kind: "error"; error: JsonSyntaxErrorDetails };

export type JsonValidationIssue = {
  path: string;
  message: string;
};

export type JsonSchemaAnalysis = {
  summary: string[];
  issues: JsonValidationIssue[];
};

type JsonSchemaObject = Record<string, unknown>;

const JSON_SCHEMA_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractErrorPosition(message: string): { position: number | null; line: number | null; column: number | null } {
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  const line = lineColumnMatch ? Number.parseInt(lineColumnMatch[1], 10) : null;
  const column = lineColumnMatch ? Number.parseInt(lineColumnMatch[2], 10) : null;

  const positionMatch = message.match(/position\s+(\d+)/i);
  const position = positionMatch ? Number.parseInt(positionMatch[1], 10) : null;

  return { position, line, column };
}

function getLineAndColumn(input: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < position; index += 1) {
    if (input[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function formatJsonPath(path: string, segment: string | number): string {
  if (typeof segment === "number") {
    return `${path}[${segment}]`;
  }

  if (path === "$") {
    return `$.${segment}`;
  }

  return `${path}.${segment}`;
}

function getSchemaTypeList(schema: JsonSchemaObject): string[] {
  const rawType = schema.type;
  if (typeof rawType === "string") {
    return [rawType];
  }

  if (Array.isArray(rawType)) {
    return rawType.filter((value): value is string => typeof value === "string");
  }

  return [];
}

function getSchemaTypeLabel(schema: JsonSchemaObject): string {
  const types = getSchemaTypeList(schema);
  return types.length ? types.join(" | ") : "any";
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `array (${value.length} item${value.length === 1 ? "" : "s"})`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    return `object (${keys.length} key${keys.length === 1 ? "" : "s"})`;
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}

function isSchemaObject(value: unknown): value is JsonSchemaObject {
  return isRecord(value);
}

function validateSchemaShape(schema: JsonSchemaObject, path: string, issues: JsonValidationIssue[]): void {
  const types = getSchemaTypeList(schema);

  if ("type" in schema && types.length === 0) {
    issues.push({
      path,
      message: "Schema type must be a string or array of strings."
    });
  }

  const invalidTypes = types.filter((type) => !JSON_SCHEMA_TYPES.has(type));
  if (invalidTypes.length > 0) {
    issues.push({
      path,
      message: `Unsupported or invalid schema type: ${invalidTypes.join(", ")}`
    });
  }

  if ("required" in schema) {
    const required = schema.required;
    if (!Array.isArray(required) || required.some((entry) => typeof entry !== "string")) {
      issues.push({
        path,
        message: "`required` must be an array of property names."
      });
    }
  }

  if ("properties" in schema) {
    const properties = schema.properties;
    if (!isRecord(properties)) {
      issues.push({
        path,
        message: "`properties` must be an object."
      });
    } else {
      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        if (!isSchemaObject(propertySchema)) {
          issues.push({
            path: formatJsonPath(path, propertyName),
            message: "Property schema must be an object."
          });
          continue;
        }

        validateSchemaShape(propertySchema, formatJsonPath(path, propertyName), issues);
      }
    }
  }

  if ("items" in schema) {
    const items = schema.items;
    if (Array.isArray(items)) {
      for (const [index, itemSchema] of items.entries()) {
        if (!isSchemaObject(itemSchema)) {
          issues.push({
            path: formatJsonPath(path, index),
            message: "Tuple item schema must be an object."
          });
          continue;
        }

        validateSchemaShape(itemSchema, formatJsonPath(path, index), issues);
      }
    } else if (items !== undefined && items !== null && !isSchemaObject(items)) {
      issues.push({
        path,
        message: "`items` must be a schema object or array of schema objects."
      });
    } else if (isSchemaObject(items)) {
      validateSchemaShape(items, formatJsonPath(path, "items"), issues);
    }
  }
}

function valueMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateAgainstSchema(value: unknown, schema: JsonSchemaObject, path: string, issues: JsonValidationIssue[]): void {
  const types = getSchemaTypeList(schema);
  if (types.length > 0 && !types.some((type) => valueMatchesType(value, type))) {
    issues.push({
      path,
      message: `Expected ${types.join(" or ")}, received ${summarizeValue(value)}.`
    });
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) {
    issues.push({
      path,
      message: "Value does not match one of the allowed enum values."
    });
  }

  if ("const" in schema && !Object.is(schema.const, value)) {
    issues.push({
      path,
      message: "Value does not match the required constant."
    });
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({
        path,
        message: `String must be at least ${schema.minLength} character${schema.minLength === 1 ? "" : "s"}.`
      });
    }

    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({
        path,
        message: `String must be at most ${schema.maxLength} characters.`
      });
    }

    if (typeof schema.pattern === "string") {
      try {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test(value)) {
          issues.push({
            path,
            message: "String does not match the required pattern."
          });
        }
      } catch {
        issues.push({
          path,
          message: "Schema pattern is not a valid regular expression."
        });
      }
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({
        path,
        message: `Number must be at least ${schema.minimum}.`
      });
    }

    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({
        path,
        message: `Number must be at most ${schema.maximum}.`
      });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push({
        path,
        message: `Array must contain at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`
      });
    }

    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      issues.push({
        path,
        message: `Array must contain at most ${schema.maxItems} items.`
      });
    }

    if (Array.isArray(schema.items)) {
      for (const [index, itemSchema] of schema.items.entries()) {
        if (index >= value.length || !isSchemaObject(itemSchema)) {
          continue;
        }

        validateAgainstSchema(value[index], itemSchema, formatJsonPath(path, index), issues);
      }
    } else if (isSchemaObject(schema.items)) {
      for (const [index, itemValue] of value.entries()) {
        validateAgainstSchema(itemValue, schema.items, formatJsonPath(path, index), issues);
      }
    }
  }

  if (isRecord(value)) {
    const propertySchemas = isRecord(schema.properties) ? schema.properties : null;
    const requiredProperties = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === "string")
      : [];

    for (const propertyName of requiredProperties) {
      if (!(propertyName in value)) {
        issues.push({
          path: formatJsonPath(path, propertyName),
          message: "Required property is missing."
        });
      }
    }

    if (propertySchemas) {
      for (const [propertyName, propertySchema] of Object.entries(propertySchemas)) {
        if (!(propertyName in value) || !isSchemaObject(propertySchema)) {
          continue;
        }

        validateAgainstSchema(value[propertyName], propertySchema, formatJsonPath(path, propertyName), issues);
      }
    }

    if (schema.additionalProperties === false && propertySchemas) {
      const allowedProperties = new Set(Object.keys(propertySchemas));
      for (const propertyName of Object.keys(value)) {
        if (!allowedProperties.has(propertyName)) {
          issues.push({
            path: formatJsonPath(path, propertyName),
            message: "Property is not allowed by the schema."
          });
        }
      }
    }
  }
}

export function parseJsonText(input: string): ParsedJsonResult {
  if (!input.trim()) {
    return { kind: "empty" };
  }

  try {
    return {
      kind: "success",
      value: JSON.parse(input) as unknown
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    const extracted = extractErrorPosition(message);
    const fallbackLineColumn =
      extracted.position !== null ? getLineAndColumn(input, extracted.position) : { line: null, column: null };

    return {
      kind: "error",
      error: {
        message,
        position: extracted.position,
        line: extracted.line ?? fallbackLineColumn.line,
        column: extracted.column ?? fallbackLineColumn.column
      }
    };
  }
}

export function formatJsonText(input: string): string | null {
  const parsed = parseJsonText(input);
  if (parsed.kind !== "success") {
    return null;
  }

  return JSON.stringify(parsed.value, null, 2);
}

export function summarizeJsonDocument(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [`Valid JSON: array with ${value.length} item${value.length === 1 ? "" : "s"}.`];
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    const summary = [`Valid JSON: object with ${keys.length} key${keys.length === 1 ? "" : "s"}.`];
    if (keys.length > 0) {
      summary.push(`Top-level keys: ${keys.slice(0, 8).join(", ")}${keys.length > 8 ? ", ..." : ""}`);
    }
    return summary;
  }

  if (value === null) {
    return ["Valid JSON: null."];
  }

  return [`Valid JSON: ${typeof value}.`];
}

export function analyzeJsonSchema(schema: unknown): JsonSchemaAnalysis {
  if (!isSchemaObject(schema)) {
    return {
      summary: [],
      issues: [{ path: "$", message: "Schema root must be an object." }]
    };
  }

  const issues: JsonValidationIssue[] = [];
  validateSchemaShape(schema, "$", issues);

  const summary: string[] = [`Root type: ${getSchemaTypeLabel(schema)}`];
  const properties = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const required = Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  if (properties.length > 0) {
    summary.push(`Properties: ${properties.slice(0, 8).join(", ")}${properties.length > 8 ? ", ..." : ""}`);
  }

  if (required.length > 0) {
    summary.push(`Required: ${required.join(", ")}`);
  }

  if (Array.isArray(schema.enum)) {
    summary.push(`Enum values: ${schema.enum.length}`);
  }

  if (schema.additionalProperties === false) {
    summary.push("Additional properties: not allowed");
  }

  return { summary, issues };
}

export function validateJsonAgainstSchema(
  value: unknown,
  schema: unknown
): { issues: JsonValidationIssue[]; note: string | null } {
  if (!isSchemaObject(schema)) {
    return {
      issues: [],
      note: "Local preview is unavailable because the class schema is not an object."
    };
  }

  const issues: JsonValidationIssue[] = [];
  validateAgainstSchema(value, schema, "$", issues);

  return {
    issues,
    note: "Local preview checks common JSON Schema keywords. Backend validation remains the source of truth."
  };
}
