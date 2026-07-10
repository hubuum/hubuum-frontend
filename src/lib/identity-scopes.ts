import type { NewGroup, NewUser } from "@/lib/api/generated/models";

export const LOCAL_IDENTITY_SCOPE = "local";
export const LOGIN_IDENTITY_SCOPE_STORAGE_KEY = "hubuum.login.identity-scope";

export type ScopedLoginCredentials = {
	identity_scope?: string;
	name: string;
	password: string;
};

export type ScopedNewUser = NewUser & {
	identity_scope?: string | null;
};

export type ScopedNewGroup = NewGroup & {
	identity_scope?: string | null;
};

export type ConsoleUser = {
	created_at: string;
	email?: string | null;
	id: number;
	identity_scope?: string;
	last_sync_attempted_at?: string | null;
	last_sync_success_at?: string | null;
	name: string;
	proper_name?: string | null;
	provider_kind?: string;
	provider_managed?: boolean;
	updated_at: string;
};

export type ConsoleGroup = {
	created_at: string;
	description: string;
	external_key?: string | null;
	groupname: string;
	id: number;
	identity_scope?: string;
	last_sync_attempted_at?: string | null;
	last_sync_success_at?: string | null;
	managed_by?: string;
	updated_at: string;
};

export type ConsolePrincipalMember = {
	created_at?: string;
	identity_scope?: string;
	kind: string;
	name: string;
	principal_id: number;
	updated_at?: string;
};

export type ConsoleServiceAccount = {
	created_at: string;
	created_by?: number | null;
	description: string;
	disabled_at?: string | null;
	id: number;
	identity_scope?: string;
	name: string;
	owner_group_id: number;
	updated_at: string;
};

export type AuthenticatedPrincipalIdentity = {
	identityScope: string;
	name: string;
};

export function normalizeIdentityScope(value: unknown): string {
	return typeof value === "string" && value.trim()
		? value.trim()
		: LOCAL_IDENTITY_SCOPE;
}

export function formatScopedIdentityName(
	identityScope: string | null | undefined,
	name: string,
): string {
	const scope = normalizeIdentityScope(identityScope);
	return scope === LOCAL_IDENTITY_SCOPE ? name : `${scope}/${name}`;
}

export function formatScopedGroupName(
	group: Pick<ConsoleGroup, "groupname"> &
		Partial<Pick<ConsoleGroup, "identity_scope">>,
): string {
	return formatScopedIdentityName(group.identity_scope, group.groupname);
}

export function formatScopedServiceAccountName(
	account: Pick<ConsoleServiceAccount, "name"> &
		Partial<Pick<ConsoleServiceAccount, "identity_scope">>,
): string {
	return formatScopedIdentityName(account.identity_scope, account.name);
}

export function isProviderManagedUser(
	user: Pick<ConsoleUser, "provider_managed">,
): boolean {
	return user.provider_managed === true;
}

export function isProviderManagedGroup(
	group: Pick<ConsoleGroup, "managed_by">,
): boolean {
	return Boolean(group.managed_by && group.managed_by !== "local");
}

export function readAuthenticatedPrincipalIdentity(
	payload: unknown,
): AuthenticatedPrincipalIdentity | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const principal = (payload as { principal?: unknown }).principal;
	if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
		return null;
	}
	const value = principal as Record<string, unknown>;
	if (typeof value.name !== "string" || !value.name.trim()) return null;
	return {
		identityScope: normalizeIdentityScope(value.identity_scope),
		name: value.name,
	};
}

export function authenticatedIdentityMatchesRequest(
	identity: AuthenticatedPrincipalIdentity | null,
	requestedScope: string | undefined,
): boolean {
	const normalizedRequest = normalizeIdentityScope(requestedScope);
	if (normalizedRequest === LOCAL_IDENTITY_SCOPE) return true;
	return identity?.identityScope === normalizedRequest;
}
