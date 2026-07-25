import { describe, expect, it } from "vitest";

import type { ComputedFieldDefinition } from "@/lib/api/generated/models";
import {
	resolveObjectServerFilterComputedFields,
	resolveObjectServerFilterDataFields,
} from "@/lib/object-server-filter-fields";

function computedDefinition(
	overrides: Partial<ComputedFieldDefinition>,
): ComputedFieldDefinition {
	return {
		class_id: 7,
		created_at: "2026-07-25T00:00:00Z",
		description: "",
		enabled: true,
		id: 1,
		key: "score",
		label: "Score",
		operation: { op: "count", path: "/items" },
		result_type: "integer",
		revision: 1,
		semantics_version: 1,
		updated_at: "2026-07-25T00:00:00Z",
		visibility: "shared",
		...overrides,
	};
}

describe("object server filter field setup", () => {
	it("uses one schema and sample path resolver for typed data filters", () => {
		const fields = resolveObjectServerFilterDataFields(
			{
				type: "object",
				properties: {
					commissioned_at: { type: "string" },
					hostname: { type: "string" },
				},
			},
			[
				{
					commissioned_at: "2026-07-25T08:30:00Z",
					hostname: "host-01",
					network: { address: "2001:db8::10" },
					"unsafe-key": "not server filterable",
				},
			],
		);

		expect(fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "commissioned_at",
					path: ["commissioned_at"],
					dataType: "date",
				}),
				expect.objectContaining({
					label: "hostname",
					path: ["hostname"],
					dataType: "string",
				}),
				expect.objectContaining({
					label: "network.address",
					path: ["network", "address"],
					dataType: "ip",
				}),
			]),
		);
		expect(fields.some((field) => field.label.includes("unsafe-key"))).toBe(
			false,
		);
	});

	it("normalizes enabled shared and personal computed fields", () => {
		const fields = resolveObjectServerFilterComputedFields(
			[
				computedDefinition({ key: "score", label: "Score" }),
				computedDefinition({
					id: 2,
					key: "disabled",
					label: "Disabled",
					enabled: false,
				}),
			],
			[
				computedDefinition({
					id: 3,
					key: "status",
					label: "Status",
					result_type: "string",
					visibility: "personal",
				}),
			],
		);

		expect(fields).toEqual([
			{
				id: "shared:score",
				key: "score",
				label: "Score",
				scope: "shared",
				resultType: "integer",
			},
			{
				id: "personal:status",
				key: "status",
				label: "Status",
				scope: "personal",
				resultType: "string",
			},
		]);
	});
});
