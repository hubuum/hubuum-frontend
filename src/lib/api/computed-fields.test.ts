import { describe, expect, it } from "vitest";

import {
	definitionRequestFromDraft,
	draftFromDefinition,
	EMPTY_COMPUTED_FIELD_DRAFT,
	pathsFromText,
} from "@/lib/api/computed-fields";

describe("computed field form helpers", () => {
	it("builds a typed operation from line-separated pointers", () => {
		const request = definitionRequestFromDraft({
			...EMPTY_COMPUTED_FIELD_DRAFT,
			key: "display_name",
			label: "Display name",
			pathsText: "/inventory/hostname\n/manual/hostname",
		});
		expect(request.operation).toEqual({
			type: "first_non_null",
			paths: ["/inventory/hostname", "/manual/hostname"],
		});
	});

	it("supports the document root marker", () => {
		expect(pathsFromText("<root>\n/name")).toEqual(["", "/name"]);
	});

	it("rejects invalid keys, pointers, arity, and result types", () => {
		const base = {
			...EMPTY_COMPUTED_FIELD_DRAFT,
			key: "valid_key",
			label: "Valid",
			pathsText: "/a",
		};
		expect(() =>
			definitionRequestFromDraft({ ...base, key: "Invalid" }),
		).toThrow("Key must match");
		expect(() =>
			definitionRequestFromDraft({ ...base, pathsText: "not-a-pointer" }),
		).toThrow("must start");
		expect(() =>
			definitionRequestFromDraft({
				...base,
				operationType: "all_present_and_equal",
			}),
		).toThrow("between 2 and 16");
		expect(() =>
			definitionRequestFromDraft({
				...base,
				operationType: "sum",
				resultType: "string",
			}),
		).toThrow("Numeric operations");
	});

	it("round-trips an existing definition into an editable draft", () => {
		const draft = draftFromDefinition({
			class_id: 1,
			created_at: "2026-07-17T00:00:00Z",
			created_by: 1,
			description: "Derived display name",
			enabled: true,
			id: 2,
			key: "display_name",
			label: "Display name",
			operation: { type: "first_non_null", paths: ["/name"] },
			owner_user_id: null,
			result_type: "string",
			revision: 3,
			semantics_version: 1,
			updated_at: "2026-07-17T00:00:00Z",
			updated_by: 1,
			visibility: "shared",
		});
		expect(draft).toMatchObject({
			key: "display_name",
			operationType: "first_non_null",
			pathsText: "/name",
		});
	});
});
