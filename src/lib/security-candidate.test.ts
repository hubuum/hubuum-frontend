import { describe, expect, it } from "vitest";
import {
	duplicateProvider,
	providerDraft,
	providerChangeSummary,
	parseProviderSettings,
	providerRequest,
	providerTemplate,
	type ProviderDraft,
	securityCandidateInput,
} from "./security-candidate";

describe("runtime provider settings", () => {
	it.each(["ldap", "oidc", "oauth"] as const)(
		"copies %s as a separate disabled identity and reviews its login impact",
		(kind) => {
			const source = {
				provider_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
				name: "employees",
				kind,
				source: "runtime" as const,
				enabled: true,
				available: true,
				definition_mutable: true,
				credential_configured: true,
				runtime_definition: {
					...providerTemplate(kind, "employees"),
					...(kind !== "ldap" ? { client_id: "office" } : {}),
				},
			};
			const original = providerDraft(source)!;
			const copy = { ...duplicateProvider(source), name: "partners" };
			expect(copy.providerId).toBeUndefined();
			expect(copy.enabled).toBe(false);
			expect(copy.adoptDeployment).toBe(false);
			expect(
				providerRequest(copy, { action: "reference", alias: "new-alias" }),
			).toMatchObject({
				name: "partners",
				enabled: false,
				source: "runtime",
				configuration:
					kind === "ldap"
						? { scope: "partners", bind_password_ref: "new-alias" }
						: { credential: { action: "reference", alias: "new-alias" } },
			});
			expect(() => providerRequest(copy, { action: "keep" })).toThrow(
				"Supply a credential",
			);
			expect(providerChangeSummary([original], [original, copy])).toEqual([
				"employees stays enabled.",
				"Add partners as disabled. Copied from employees.",
			]);
		},
	);
	it("requires an actual copy projection from deployment and rejects secret-bearing projections", () => {
		const source = {
			name: "employees",
			kind: "ldap",
			source: "deployment" as const,
			enabled: true,
			available: true,
			definition_mutable: false,
			credential_configured: true,
		};
		expect(() => duplicateProvider(source)).toThrow("did not supply");
		expect(() =>
			duplicateProvider({
				...source,
				deployment_copy_definition: { bind_password_ref: "private" },
			}),
		).toThrow("write-only");
		const copy = duplicateProvider({
			...source,
			deployment_copy_definition: {
				url: "ldaps://office.example",
				bind_dn: "cn=service",
			},
		});
		expect(copy).toMatchObject({
			copiedFrom: "employees",
			name: "",
			source: "runtime",
			credentialAction: "reference",
		});
		expect(JSON.parse(copy.configurationText)).toEqual({
			url: "ldaps://office.example",
			bind_dn: "cn=service",
		});
	});
	it.each(["ldap", "oidc", "oauth"] as const)(
		"round-trips a %s non-secret settings template",
		(kind) => {
			const input = providerTemplate(kind, "company");
			expect(parseProviderSettings(JSON.stringify(input))).toEqual(input);
		},
	);
	it.each([
		[{ action: "keep" }, {}],
		[{ action: "clear" }, { bind_password: null, bind_password_ref: null }],
		[
			{ action: "reference", alias: "fixture-reference" },
			{ bind_password: null, bind_password_ref: "fixture-reference" },
		],
		[
			{ action: "replace", value: "fixture-replacement" },
			{ bind_password: "fixture-replacement", bind_password_ref: null },
		],
	] as const)("preserves LDAP %j write-only intent", (secret, expected) => {
		const configuration = providerTemplate("ldap", "company");
		const draft: ProviderDraft = {
			key: "draft",
			name: "company",
			kind: "ldap",
			source: "runtime",
			enabled: true,
			adoptDeployment: false,
			configurationText: JSON.stringify(configuration),
			credentialAction: secret.action,
		};
		expect(providerRequest(draft, secret)).toMatchObject({
			kind: "ldap",
			configuration: { ...configuration, ...expected },
		});
	});
	it("preserves non-secret protocol and membership fields", () => {
		const input = {
			issuer: "https://identity.example",
			retain_refresh_tokens: true,
			membership: { mode: "local_only" },
		};
		expect(parseProviderSettings(JSON.stringify(input))).toEqual(input);
	});
	it.each([
		"bind_password",
		"bind_password_ref",
		"credential",
		"client_secret",
		"alias",
		"runtime_bind_password_envelope",
		"Authorization",
		"Cookie",
	])("keeps %s out of the non-secret editor", (key) => {
		expect(() =>
			parseProviderSettings(
				JSON.stringify({ nested: { [key]: "fixture-only" } }),
			),
		).toThrow("write-only");
	});
	it.each(["not-json", "[]", "null", "12"])(
		"rejects malformed settings %s",
		(input) => {
			expect(() => parseProviderSettings(input)).toThrow();
		},
	);
	it("does not accept a receipt or approval supplied with candidate creation", () => {
		expect(
			securityCandidateInput.safeParse({
				group: "authentication",
				expected_revision: 1,
				providers: [],
				verification_receipt: "fixture",
			}).success,
		).toBe(false);
	});
	it.each(["ldap", "oidc", "oauth"])(
		"supports a deployment-owned %s reference",
		(kind) => {
			expect(
				securityCandidateInput.safeParse({
					group: "authentication",
					expected_revision: 1,
					providers: [
						{ source: "deployment", kind, name: "company", enabled: true },
					],
				}).success,
			).toBe(true);
		},
	);
	it("preserves a complete bounded runtime Treetop connection for server validation", () => {
		const input = {
			group: "authorization",
			expected_revision: 1,
			source: "runtime",
			backend: "treetop",
			connection: {
				url: "https://policy.example",
				trust_profile_id: "system",
				connect_timeout_ms: 1000,
				request_timeout_ms: 2000,
			},
		};
		expect(securityCandidateInput.parse(input)).toEqual(input);
	});
});
