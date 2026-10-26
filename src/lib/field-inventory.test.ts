import { describe, expect, it } from "vitest";
import type {
	ClassFieldInventory,
	DiscoveredField,
	FieldPathSegment,
} from "@/lib/api/generated/models";
import {
	arrayItemCount,
	fieldForJsonPointer,
	jsonPointerFromFieldPath,
} from "@/lib/computed-field-editor";
import {
	discoveredFieldKey,
	discoverJsonFields,
	inventoryDataFields,
} from "@/lib/json-field-discovery";
import { discoveredServerFilterDataFields } from "@/lib/object-server-filter-fields";

function inventory(paths: FieldPathSegment[][]): ClassFieldInventory {
	return {
		sampled: true,
		sampled_objects: 2,
		effective_sample_limit: 100,
		max_depth: 6,
		include_containers: true,
		truncation: [],
		fields: paths.map((path) => ({
			field: "colliding label",
			path,
			source: "data",
			types: { string: 3 },
			observation_count: 3,
			object_count: 2,
			error_count: 0,
			example: "bounded preview",
			example_truncated: true,
		})),
	};
}

describe("field inventory paths", () => {
	it.each([
		["a.b", "/a.b", 'item.data["a.b"]'],
		["a/b~", "/a~1b~0", 'item.data["a/b~"]'],
		["[#]", "/[#]", 'item.data["[#]"]'],
		["[0]", "/[0]", 'item.data["[0]"]'],
		["", "/", 'item.data[""]'],
	])(
		"preserves literal property %s in server and schema fields",
		(name, pointer, expression) => {
			const schema = {
				type: "object",
				properties: { [name]: { type: "string" } },
			};
			const fromServer = inventoryDataFields(
				schema,
				inventory([[{ kind: "property", name }]]),
			);
			for (const fields of [
				fromServer,
				discoverJsonFields(schema, [{ [name]: "value" }]),
			]) {
				expect(fields).toHaveLength(1);
				const field = fields[0];
				expect(arrayItemCount(field.path, field.structuredPath)).toBe(0);
				expect(
					jsonPointerFromFieldPath(field.path, [], field.structuredPath),
				).toBe(pointer);
				expect(fieldForJsonPointer(fields, pointer)).toBe(field);
				expect(field.templateExpression).toBe(expression);
			}
		},
	);
	it("keeps array traversal distinct from marker-shaped properties and display labels", () => {
		const fields = inventoryDataFields(
			null,
			inventory([
				[{ kind: "property", name: "values" }, { kind: "array_item" }],
				[
					{ kind: "property", name: "values" },
					{ kind: "property", name: "[#]" },
				],
			]),
		);
		expect(new Set(fields.map(discoveredFieldKey)).size).toBe(2);
		const array = fields.find(
			(field) => field.structuredPath?.[1].kind === "array_item",
		);
		expect(array).toBeDefined();
		if (!array) throw new Error("Missing array field");
		expect(
			jsonPointerFromFieldPath(array.path, [], array.structuredPath),
		).toBeNull();
		expect(
			jsonPointerFromFieldPath(array.path, ["12"], array.structuredPath),
		).toBe("/values/12");
		expect(fieldForJsonPointer(fields, "/values/12")).toBe(array);
		expect(fieldForJsonPointer(fields, "/values/[#]")).not.toBe(array);
	});
	it("merges observed data with declared fields without treating computed values as raw data", () => {
		const observed = inventory([[{ kind: "property", name: "unexpected" }]]);
		observed.fields.push({
			...observed.fields[0],
			source: "shared_computed",
		} as DiscoveredField);
		const fields = inventoryDataFields(
			{ properties: { declared: { type: "boolean" } } },
			observed,
		);
		expect(fields.map((field) => field.label)).toEqual([
			"declared",
			"unexpected",
		]);
		expect(fields[1].observedIn).toBe(2);
	});
	it("uses reported types instead of parsing truncated example previews", () => {
		const observed = inventory([[{ kind: "property", name: "count" }]]);
		observed.fields[0].types = { number: 3 };
		observed.fields[0].example = "192.168.0.1";
		expect(
			discoveredServerFilterDataFields(
				null,
				inventoryDataFields(null, observed),
			),
		).toMatchObject([{ dataType: "number", path: ["count"] }]);
	});
});
