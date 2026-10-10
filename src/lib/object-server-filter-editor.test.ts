import { describe, expect, it } from "vitest";

import {
	getObjectServerFilterEditorDataFields,
	getObjectServerFilterEditorDraft,
	replaceObjectServerFilter,
} from "@/lib/object-server-filter-editor";
import { resolveObjectServerFilterDataFields } from "@/lib/object-server-filter-fields";
import {
	getObjectServerFilterIdentity,
	type ObjectServerFilter,
} from "@/lib/object-server-filters";

describe("object server filter editing", () => {
	const dataFields = [
		{
			id: '["system","hostname"]',
			label: "system · hostname",
			path: ["system", "hostname"],
			dataType: "string" as const,
		},
	];
	const computedFields = [
		{
			id: "shared:risk",
			key: "risk",
			label: "Risk",
			scope: "shared" as const,
			resultType: "number" as const,
		},
	];

	it.each([
		{ operator: "regex", value: "^9$" },
		{ operator: "is_null", value: "" },
	] as const)(
		"keeps $operator filters editable beyond the sample discovery limit",
		({ operator, value }) => {
			const filters: ObjectServerFilter[] = [
				{
					field: "json_data",
					operator,
					path: ["system", "version"],
					value,
				},
			];
			const discoveredFields = resolveObjectServerFilterDataFields(null, [
				...Array.from({ length: 100 }, () => ({ other: "value" })),
				{ system: { version: 9 } },
			]);
			expect(discoveredFields.map((field) => field.path)).toEqual([["other"]]);
			const fields = getObjectServerFilterEditorDataFields(
				discoveredFields,
				filters,
			);
			expect(getObjectServerFilterEditorDraft(filters[0], fields, [])).toEqual({
				field: 'data:["system","version"]',
				negated: false,
				operator,
				value,
			});
		},
	);

	it("preserves discovered types and adds missing paths only once", () => {
		const filters: ObjectServerFilter[] = [
			{
				field: "json_data",
				operator: "equals",
				path: ["system", "hostname"],
				value: "edge-1",
			},
			{
				field: "json_data",
				operator: "is_null",
				path: ["optional"],
				value: "",
			},
		];
		expect(
			getObjectServerFilterEditorDataFields(dataFields, [
				...filters,
				filters[1],
			]),
		).toEqual([
			...dataFields,
			{
				id: '["optional"]',
				label: "optional",
				path: ["optional"],
				dataType: "unknown",
			},
		]);
	});

	it("loads base, data, and computed filters back into the visual editor", () => {
		expect(
			getObjectServerFilterEditorDraft(
				{
					field: "name",
					operator: "not_icontains",
					value: "retired",
				},
				dataFields,
				computedFields,
			),
		).toEqual({
			field: "name",
			negated: true,
			operator: "icontains",
			value: "retired",
		});
		expect(
			getObjectServerFilterEditorDraft(
				{
					field: "json_data",
					operator: "equals",
					path: ["system", "hostname"],
					value: "edge-1",
				},
				dataFields,
				computedFields,
			)?.field,
		).toBe('data:["system","hostname"]');
		expect(
			getObjectServerFilterEditorDraft(
				{
					field: "computed",
					operator: "gte",
					value: "70",
					computedScope: "shared",
					computedKey: "risk",
					computedResultType: "number",
				},
				dataFields,
				computedFields,
			)?.field,
		).toBe("computed:shared:risk");
	});

	it("replaces only the edited predicate, preserving other conditions on the same field", () => {
		const filters: ObjectServerFilter[] = [
			{ field: "name", operator: "icontains", value: "edge" },
			{ field: "description", operator: "icontains", value: "active" },
			{ field: "name", operator: "equals", value: "existing" },
		];

		expect(
			replaceObjectServerFilter(
				filters,
				getObjectServerFilterIdentity(filters[0]),
				{ field: "name", operator: "equals", value: "replacement" },
			),
		).toEqual([
			{ field: "name", operator: "equals", value: "replacement" },
			{ field: "description", operator: "icontains", value: "active" },
			{ field: "name", operator: "equals", value: "existing" },
		]);
	});
});
