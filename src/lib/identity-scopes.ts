import type {
	GroupResponse,
	LoginUser,
	NewGroup,
	NewUser,
	PrincipalMemberResponse,
	ServiceAccountResponse,
	UserResponse,
} from "@/lib/api/generated/models";

export const LOCAL_IDENTITY_SCOPE = "local";
export const LOGIN_IDENTITY_SCOPE_STORAGE_KEY = "hubuum.login.identity-scope";

export type ScopedLoginCredentials = LoginUser;
export type ScopedNewUser = NewUser;
export type ScopedNewGroup = NewGroup;
export type ConsoleUser = UserResponse;
export type ConsoleGroup = GroupResponse;
export type ConsolePrincipalMember = PrincipalMemberResponse;
export type ConsoleServiceAccount = ServiceAccountResponse;

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
	user: { provider_managed?: boolean | null },
): boolean {
	return user.provider_managed === true;
}

export function isProviderManagedGroup(
	group: { managed_by?: string | null },
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
	requestedScope: string | null | undefined,
): boolean {
	const normalizedRequest = normalizeIdentityScope(requestedScope);
	if (normalizedRequest === LOCAL_IDENTITY_SCOPE) return true;
	return identity?.identityScope === normalizedRequest;
}
