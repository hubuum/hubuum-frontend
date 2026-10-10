import { describe, expect, it } from "vitest";

import {
	getObjectServerFilterEditorDraft,
	replaceObjectServerFilter,
} from "@/lib/object-server-filter-editor";
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
