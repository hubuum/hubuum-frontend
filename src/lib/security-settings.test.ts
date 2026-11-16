import { describe, expect, it } from "vitest";
import type { RuntimeSettingsState } from "@/lib/api/runtime-settings";
import {
	authenticationDraft,
	authorizationDraft,
	providerCallback,
} from "./security-settings";

const state: RuntimeSettingsState = {
	group: "authentication",
	source: "runtime",
	revision: 7,
	mutable: true,
	restart_required: false,
	takes_effect: "immediate",
	replica: { status: "current" },
	effective: { providers: [] },
	runtime: null,
	deployment: null,
	constrained_by_ceiling: false,
};
const provider = {
	provider_id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
	name: "company",
	kind: "ldap",
	source: "runtime",
	enabled: true,
	available: true,
	definition_mutable: true,
	credential_configured: true,
	runtime_definition: { scope: "company", url: "ldaps://directory.example" },
};
describe("security settings draft boundaries", () => {
	it("keeps all existing external providers and preserves their stable identity", () => {
		const result = authenticationDraft({
			...state,
			effective: { providers: [provider] },
		});
		expect(result.drafts).toMatchObject([
			{
				providerId: provider.provider_id,
				name: "company",
				credentialAction: "keep",
				enabled: true,
			},
		]);
	});
	it("does not silently omit a future provider kind", () => {
		expect(() =>
			authenticationDraft({
				...state,
				effective: { providers: [{ ...provider, kind: "future" }] },
			}),
		).toThrow("unsupported provider");
	});
	it("local accounts have no editable provider definition", () => {
		expect(
			authenticationDraft({
				...state,
				effective: {
					providers: [
						{ ...provider, kind: "local", name: "local", provider_id: null },
					],
				},
			}).drafts,
		).toEqual([]);
	});
	it("preserves a requested Treetop backend even when the effective backend differs", () => {
		expect(
			authorizationDraft({
				...state,
				group: "authorization",
				effective: { backend: "local" },
				runtime: {
					backend: "treetop",
					connection: {
						url: "https://policy.example",
						trust_profile_id: "system",
						connect_timeout_ms: 1000,
						request_timeout_ms: 2000,
					},
				},
			}),
		).toMatchObject({
			backend: "treetop",
			source: "runtime",
			connection: { url: "https://policy.example" },
		});
	});
	it("does not turn an unknown authorization backend into Local", () => {
		expect(() =>
			authorizationDraft({
				...state,
				group: "authorization",
				effective: { backend: "future" },
			}),
		).toThrow();
	});
	it("builds the public callback from the server's origin and candidate provider identity", () => {
		expect(
			providerCallback("https://auth.example:444", provider.provider_id),
		).toBe(
			`https://auth.example:444/api/v1/auth/callbacks/${provider.provider_id}`,
		);
	});
	it.each([
		"https://user:pass@auth.example",
		"https://auth.example/path",
		"https://auth.example/?code=x",
		"http://auth.example",
		"invalid",
	])("does not display an untrusted callback origin %s", (origin) => {
		expect(providerCallback(origin, provider.provider_id)).toBeNull();
	});
});
