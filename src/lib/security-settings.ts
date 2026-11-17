import { z } from "zod";
import type { SecurityCandidateRequest } from "@/lib/api/generated/models";
import type { RuntimeSettingsState } from "@/lib/api/runtime-settings";
import {
	externalProviderKind,
	providerDraft,
	providerStatusesSchema,
} from "@/lib/security-candidate";

export function authenticationDraft(state: RuntimeSettingsState) {
	const providers = providerStatusesSchema.parse(state.effective.providers);
	if (
		providers.some(
			(provider) =>
				provider.kind !== "local" && !externalProviderKind(provider.kind),
		)
	)
		throw new Error(
			"This server advertises an unsupported provider kind. Upgrade the frontend before changing authentication.",
		);
	return {
		providers,
		drafts: providers.flatMap((provider) => {
			const draft = providerDraft(provider);
			return draft ? [draft] : [];
		}),
	};
}

const authorization = z.object({
	backend: z.enum(["local", "treetop"]),
	connection: z
		.object({
			url: z.string(),
			trust_profile_id: z.string(),
			connect_timeout_ms: z.number().int(),
			request_timeout_ms: z.number().int(),
		})
		.nullish(),
});
export function authorizationDraft(state: RuntimeSettingsState) {
	const parsed = authorization.parse(state.runtime ?? state.effective);
	const deployment = authorization.safeParse(state.deployment);
	return {
		...parsed,
		deploymentBackend: deployment.success ? deployment.data.backend : null,
		source:
			state.source === "runtime"
				? ("runtime" as const)
				: ("deployment" as const),
	};
}

export function authorizationReleaseRequest(
	state: RuntimeSettingsState,
): SecurityCandidateRequest {
	const deployment = authorization.safeParse(state.deployment);
	if (
		state.group !== "authorization" ||
		state.revision === null ||
		!deployment.success
	)
		throw new Error(
			"Reload a known deployment authorization configuration before releasing ownership.",
		);
	return {
		group: "authorization",
		expected_revision: state.revision,
		backend: deployment.data.backend,
		source: "deployment",
		release_ownership: true,
	};
}

export function providerCallback(
	origin: string | null | undefined,
	id: string,
): string | null {
	if (!origin) return null;
	try {
		const url = new URL(origin);
		if (
			url.username ||
			url.password ||
			url.search ||
			url.hash ||
			url.pathname !== "/" ||
			(url.protocol !== "https:" &&
				!(
					url.protocol === "http:" &&
					["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
				))
		)
			return null;
		return `${url.origin}/api/v1/auth/callbacks/${z.uuid().parse(id)}`;
	} catch {
		return null;
	}
}
