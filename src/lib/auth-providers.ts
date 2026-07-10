import { LOCAL_IDENTITY_SCOPE } from "@/lib/identity-scopes";

const MAX_AUTH_PROVIDERS = 100;
const MAX_PROVIDER_NAME_LENGTH = 160;

export type AuthProvidersResponse = {
	providers: string[];
};

export function normalizeAuthProvidersResponse(
	value: unknown,
): AuthProvidersResponse | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const providers = (value as { providers?: unknown }).providers;
	if (!Array.isArray(providers) || providers.length > MAX_AUTH_PROVIDERS) {
		return null;
	}

	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const provider of providers) {
		if (typeof provider !== "string") return null;
		const name = provider.trim();
		if (!name || name.length > MAX_PROVIDER_NAME_LENGTH) return null;
		if (!seen.has(name)) {
			seen.add(name);
			normalized.push(name);
		}
	}

	return { providers: normalized };
}

export function getLoginProviderOptions(
	providers: readonly string[],
): string[] {
	return providers.includes(LOCAL_IDENTITY_SCOPE)
		? [...providers]
		: [LOCAL_IDENTITY_SCOPE, ...providers];
}

export function selectAvailableProvider(
	providers: readonly string[],
	requestedProvider: string,
): string {
	const requested = requestedProvider.trim() || LOCAL_IDENTITY_SCOPE;
	if (providers.includes(requested)) return requested;
	if (providers.includes(LOCAL_IDENTITY_SCOPE)) return LOCAL_IDENTITY_SCOPE;
	return providers[0] ?? LOCAL_IDENTITY_SCOPE;
}
