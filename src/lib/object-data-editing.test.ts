import { describe, expect, it } from "vitest";

import {
	createObjectDataFieldValue,
	getObjectDataFieldType,
	getObjectDataValue,
	parseObjectDataPath,
	setObjectDataValue,
} from "@/lib/object-data-editing";

describe("parseObjectDataPath", () => {
	it("parses nested object keys, array positions, and escaped punctuation", () => {
		expect(parseObjectDataPath("hardware.cpu[0].model")).toEqual({
			ok: true,
			segments: ["hardware", "cpu", 0, "model"],
		});
		expect(parseObjectDataPath("network\\.name.path\\\\key")).toEqual({
			ok: true,
			segments: ["network.name", "path\\key"],
		});
		expect(parseObjectDataPath('rack\\[slot\\][0]["port.name"]')).toEqual({
			ok: true,
			segments: ["rack[slot]", 0, "port.name"],
		});
		expect(parseObjectDataPath('[""]')).toEqual({
			ok: true,
			segments: [""],
		});
	});

	it("rejects ambiguous or incomplete paths", () => {
		for (const path of ["", ".name", "hardware..cpu", "array[-1]", "a\\"]) {
			expect(parseObjectDataPath(path).ok).toBe(false);
		}
	});
});

describe("getObjectDataValue", () => {
	it("distinguishes present null values from missing paths", () => {
		const data = { items: [{ value: null }] };
		expect(getObjectDataValue(data, ["items", 0, "value"])).toEqual({
			found: true,
			value: null,
		});
		expect(getObjectDataValue(data, ["items", 1])).toEqual({
			found: false,
			value: undefined,
		});
	});
});

describe("setObjectDataValue", () => {
	it("updates nested leaves without mutating the original structure", () => {
		const original = {
			hardware: { cpu: [{ model: "Xeon", cores: 48 }] },
			stable: true,
		};
		const result = setObjectDataValue(
			original,
			["hardware", "cpu", 0, "cores"],
			64,
		);

		expect(result).toEqual({
			ok: true,
			value: {
				hardware: { cpu: [{ model: "Xeon", cores: 64 }] },
				stable: true,
			},
		});
		expect(original.hardware.cpu[0].cores).toBe(48);
	});

	it("creates missing object branches and appends array entries", () => {
		const nested = setObjectDataValue({}, ["hardware", "rack", "name"], "A1");
		expect(nested).toEqual({
			ok: true,
			value: { hardware: { rack: { name: "A1" } } },
		});

		const appended = setObjectDataValue(
			{ interfaces: [{ name: "eth0" }] },
			["interfaces", 1],
			{ name: "eth1" },
		);
		expect(appended).toEqual({
			ok: true,
			value: { interfaces: [{ name: "eth0" }, { name: "eth1" }] },
		});
	});

	it("rejects incompatible containers and sparse array writes", () => {
		expect(setObjectDataValue({ hardware: "unknown" }, ["hardware", "cpu"], 1)).toMatchObject({
			ok: false,
		});
		expect(setObjectDataValue({ items: [] }, ["items", 2], "late")).toMatchObject({
			ok: false,
		});
	});
});

describe("object data field values", () => {
	it("preserves explicit JSON types", () => {
		expect(createObjectDataFieldValue("string", "42")).toEqual({
			ok: true,
			value: "42",
		});
		expect(createObjectDataFieldValue("number", "42")).toEqual({
			ok: true,
			value: 42,
		});
		expect(createObjectDataFieldValue("boolean", "true")).toEqual({
			ok: true,
			value: true,
		});
		expect(createObjectDataFieldValue("null", "ignored")).toEqual({
			ok: true,
			value: null,
		});
		expect(createObjectDataFieldValue("object", "ignored")).toEqual({
			ok: true,
			value: {},
		});
		expect(createObjectDataFieldValue("array", "ignored")).toEqual({
			ok: true,
			value: [],
		});
	});

	it("classifies JSON-compatible values", () => {
		expect([
			getObjectDataFieldType("value"),
			getObjectDataFieldType(1),
			getObjectDataFieldType(false),
			getObjectDataFieldType(null),
			getObjectDataFieldType({}),
			getObjectDataFieldType([]),
		]).toEqual(["string", "number", "boolean", "null", "object", "array"]);
	});

	it("rejects empty and non-finite numbers", () => {
		expect(createObjectDataFieldValue("number", "").ok).toBe(false);
		expect(createObjectDataFieldValue("number", "Infinity").ok).toBe(false);
	});
});
