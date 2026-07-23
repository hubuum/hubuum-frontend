import { describe, expect, it } from "vitest";

import {
	canSubmitResourceScopes,
	countResourceScopesByKind,
	tokenResourceScopeKey,
	toResourceScopesPayload,
	type NamedTokenResourceScope,
} from "@/lib/token-resource-scope-selection";

const selected: NamedTokenResourceScope[] = [
	{ kind: "collection", id: 7, label: "Production" },
	{ kind: "class", id: 12, label: "Servers" },
	{ kind: "object", id: 99, label: "api-01" },
];

describe("token-resource-scope-selection", () => {
	it("omits the resource dimension when it is unrestricted", () => {
		expect(toResourceScopesPayload(false, selected)).toBeUndefined();
	});

	it("maps named selections to the API resource scope shape", () => {
		expect(toResourceScopesPayload(true, selected)).toEqual([
			{ kind: "collection", id: 7 },
			{ kind: "class", id: 12 },
			{ kind: "object", id: 99 },
		]);
	});

	it("requires at least one resource when restriction is enabled", () => {
		expect(canSubmitResourceScopes(true, [])).toBe(false);
		expect(canSubmitResourceScopes(true, selected)).toBe(true);
		expect(canSubmitResourceScopes(false, [])).toBe(true);
	});

	it("builds stable keys and counts each resource kind", () => {
		expect(tokenResourceScopeKey(selected[1])).toBe("class:12");
		expect(countResourceScopesByKind(selected)).toEqual({
			collection: 1,
			class: 1,
			object: 1,
		});
	});
});
