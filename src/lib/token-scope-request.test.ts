import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import { toTokenScopeRequest } from "@/lib/token-scope-request";

const resource = {
	kind: "collection" as const,
	id: 17,
	label: "Production",
};

describe("toTokenScopeRequest", () => {
	it("omits both unrestricted dimensions", () => {
		expect(
			toTokenScopeRequest({
				permissions: [],
				resources: [],
				restrictPermissions: false,
				restrictResources: false,
			}),
		).toEqual({});
	});

	it("builds independent permission and resource dimensions", () => {
		expect(
			toTokenScopeRequest({
				permissions: [Permissions.ReadCollection],
				resources: [resource],
				restrictPermissions: true,
				restrictResources: true,
			}),
		).toEqual({
			scopes: [Permissions.ReadCollection],
			resource_scopes: [{ kind: "collection", id: 17 }],
		});
	});

	it("can restrict only the resource dimension", () => {
		expect(
			toTokenScopeRequest({
				permissions: [],
				resources: [resource],
				restrictPermissions: false,
				restrictResources: true,
			}),
		).toEqual({
			resource_scopes: [{ kind: "collection", id: 17 }],
		});
	});
});
