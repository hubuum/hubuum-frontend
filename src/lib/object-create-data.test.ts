import { describe, expect, it } from "vitest";

import {
	buildObjectCreateDataModel,
	isObjectCreatePathAllowed,
	removeObjectCreateDataValue,
} from "@/lib/object-create-data";

const schema = {
	type: "object",
	additionalProperties: false,
	required: ["hostname", "hardware"],
	properties: {
		hostname: { type: "string" },
		environment: { type: "string", default: "production" },
		hardware: {
			type: "object",
			additionalProperties: false,
			required: ["cpu_count"],
			properties: {
				cpu_count: { type: "integer", default: 2 },
				model: { type: "string" },
			},
		},
	},
};

describe("buildObjectCreateDataModel", () => {
	it("preloads required schema fields and keeps optional fields available", () => {
		const model = buildObjectCreateDataModel(schema, []);

		expect(model.initialData).toEqual({
			hostname: "",
			hardware: { cpu_count: 2 },
		});
		expect(
			model.fields
				.filter((field) => field.required)
				.map((field) => field.label),
		).toEqual(["hardware.cpu_count", "hostname"]);
		expect(model.fields.find((field) => field.label === "environment")).toMatchObject(
			{
				initialValue: "production",
				required: false,
				source: "schema",
			},
		);
		expect(model.allowsNewFields).toBe(false);
	});

	it("combines schema and observed fields when the schema permits them", () => {
		const permissiveSchema = {
			type: "object",
			properties: { hostname: { type: "string" } },
		};
		const model = buildObjectCreateDataModel(permissiveSchema, [
			{ hostname: "web-01", rack: "A4" },
		]);

		expect(model.fields.map((field) => [field.label, field.source])).toEqual([
			["hostname", "schema"],
			["rack", "sampled"],
		]);
		expect(model.allowsNewFields).toBe(true);
	});

	it("omits observed fields rejected by a closed schema", () => {
		const model = buildObjectCreateDataModel(schema, [
			{ hostname: "web-01", legacy: true },
		]);

		expect(model.fields.some((field) => field.label === "legacy")).toBe(false);
	});
});

describe("object create paths", () => {
	it("honors additionalProperties at each object level", () => {
		expect(isObjectCreatePathAllowed(schema, ["other"])).toBe(false);
		expect(isObjectCreatePathAllowed(schema, ["hardware", "other"])).toBe(
			false,
		);
		expect(
			isObjectCreatePathAllowed(
				{
					...schema,
					properties: {
						...schema.properties,
						hardware: {
							...schema.properties.hardware,
							additionalProperties: true,
						},
					},
				},
				["hardware", "other"],
			),
		).toBe(true);
	});

	it("removes an active field without mutating sibling data", () => {
		expect(
			removeObjectCreateDataValue(
				{ hostname: "web-01", hardware: { cpu_count: 2, model: "x" } },
				["hardware", "model"],
			),
		).toEqual({ hostname: "web-01", hardware: { cpu_count: 2 } });
	});
});
