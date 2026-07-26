import { getApiV1Config } from "@/lib/api/generated/client";
import type {
	ClientAuthenticationConfig,
	ClientConfig,
	ClientPaginationConfig,
} from "@/lib/api/generated/models";

export async function fetchClientConfig(): Promise<ClientConfig | null> {
	try {
		const response = await getApiV1Config({ credentials: "include" });
		return response.status === 200 ? response.data : null;
	} catch {
		return null;
	}
}

export async function fetchClientPaginationConfig(): Promise<ClientPaginationConfig | null> {
	const config = await fetchClientConfig();
	return config?.pagination ?? null;
}

export async function fetchClientAuthenticationConfig(): Promise<ClientAuthenticationConfig | null> {
	const config = await fetchClientConfig();
	return config?.authentication ?? null;
}

export function formatDefaultTokenLifetime(
	defaultLifetimeHours: number | null | undefined,
): string | null {
	if (
		typeof defaultLifetimeHours !== "number" ||
		!Number.isFinite(defaultLifetimeHours) ||
		defaultLifetimeHours < 1
	) {
		return null;
	}

	return `${defaultLifetimeHours} ${
		defaultLifetimeHours === 1 ? "hour" : "hours"
	}`;
}

export function formatDefaultTokenLifetimeNote(
	defaultLifetimeHours: number | null | undefined,
): string {
	const lifetime = formatDefaultTokenLifetime(defaultLifetimeHours);
	return lifetime
		? `Leave blank to use the server default lifetime of ${lifetime}.`
		: "Leave blank to use the server's configured default lifetime.";
}
