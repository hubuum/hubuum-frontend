import { describe, expect, it } from "vitest";

import {
	authenticatedIdentityMatchesRequest,
	formatScopedIdentityName,
	isProviderManagedGroup,
	normalizeIdentityScope,
	readAuthenticatedPrincipalIdentity,
} from "@/lib/identity-scopes";

describe("identity scope compatibility", () => {
	it("defaults missing scopes to local and qualifies external names", () => {
		expect(normalizeIdentityScope(" ")).toBe("local");
		expect(formatScopedIdentityName(undefined, "alice")).toBe("alice");
		expect(formatScopedIdentityName("directory", "alice")).toBe(
			"directory/alice",
		);
	});

	it("reads old and scoped current-principal responses", () => {
		expect(
			readAuthenticatedPrincipalIdentity({
				principal: { name: "alice" },
			}),
		).toEqual({ identityScope: "local", name: "alice" });
		expect(
			readAuthenticatedPrincipalIdentity({
				principal: { identity_scope: "directory", name: "alice" },
			}),
		).toEqual({ identityScope: "directory", name: "alice" });
	});

	it("requires proof that a requested external scope was honored", () => {
		expect(
			authenticatedIdentityMatchesRequest(
				{ identityScope: "directory", name: "alice" },
				"directory",
			),
		).toBe(true);
		expect(
			authenticatedIdentityMatchesRequest(
				{ identityScope: "local", name: "alice" },
				"directory",
			),
		).toBe(false);
		expect(authenticatedIdentityMatchesRequest(null, undefined)).toBe(true);
	});

	it("treats non-local group management as provider-managed", () => {
		expect(isProviderManagedGroup({ managed_by: undefined })).toBe(false);
		expect(isProviderManagedGroup({ managed_by: "local" })).toBe(false);
		expect(isProviderManagedGroup({ managed_by: "ldap" })).toBe(true);
	});
});
