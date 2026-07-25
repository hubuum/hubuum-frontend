import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import {
	formatTokenMetadataScope,
	formatTokenScopeDetails,
	groupTokenResourceScopes,
} from "@/lib/token-scope-details";

describe("formatTokenScopeDetails", () => {
	it("identifies an absent scope as unscoped", () => {
		expect(formatTokenScopeDetails(null)).toBe("Unscoped");
		expect(formatTokenScopeDetails(undefined)).toBe("Unscoped");
	});

	it("formats both exact scope dimensions", () => {
		expect(
			formatTokenScopeDetails({
				permissions: [
					Permissions.ReadCollection,
					Permissions.ReadClass,
				],
				resources: [
					{ kind: "collection", id: 17 },
					{ kind: "class", id: 23 },
					{ kind: "class", id: 42 },
				],
			}),
		).toBe("2 permissions · 1 collection, 2 classes");
	});

	it("describes omitted dimensions as unrestricted", () => {
		expect(
			formatTokenScopeDetails({
				resources: [{ kind: "object", id: 99 }],
			}),
		).toBe("all permissions · 1 object");
		expect(
			formatTokenScopeDetails({
				permissions: [Permissions.ReadObject],
			}),
		).toBe("1 permission · all resources");
	});

	it("keeps legacy scoped metadata distinguishable during the transition", () => {
		expect(formatTokenMetadataScope({ scoped: true })).toBe(
			"Scoped · details unavailable",
		);
		expect(formatTokenMetadataScope({ scoped: false })).toBe("Unscoped");
	});

	it("groups every resource entry by its exact scope kind", () => {
		expect(
			groupTokenResourceScopes([
				{ kind: "object", id: 99 },
				{ kind: "collection", id: 17 },
				{ kind: "class", id: 23 },
				{ kind: "object", id: 101 },
			]),
		).toEqual({
			collection: [{ kind: "collection", id: 17 }],
			class: [{ kind: "class", id: 23 }],
			object: [
				{ kind: "object", id: 99 },
				{ kind: "object", id: 101 },
			],
		});
		expect(groupTokenResourceScopes(null)).toEqual({
			collection: [],
			class: [],
			object: [],
		});
	});
});
