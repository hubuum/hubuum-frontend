import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import { canSubmitScopes, toScopesPayload } from "@/lib/token-scope-selection";

describe("token-scope-selection", () => {
	it("returns undefined (unscoped) when restriction is off", () => {
		expect(toScopesPayload(false, [Permissions.ReadObject])).toBeUndefined();
	});

	it("returns the selected scopes when restriction is on", () => {
		expect(toScopesPayload(true, [Permissions.ReadObject])).toEqual([
			Permissions.ReadObject,
		]);
	});

	it("never yields an empty array (returns undefined instead)", () => {
		expect(toScopesPayload(true, [])).toBeUndefined();
	});

	it("blocks submit when restricting with no scopes selected", () => {
		expect(canSubmitScopes(true, [])).toBe(false);
	});

	it("allows submit when unrestricted", () => {
		expect(canSubmitScopes(false, [])).toBe(true);
	});

	it("allows submit when restricting with at least one scope", () => {
		expect(canSubmitScopes(true, [Permissions.ReadObject])).toBe(true);
	});
});
