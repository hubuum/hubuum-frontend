import type {
	ServiceAccountResponse,
	UserResponse,
} from "@/lib/api/generated/models";
import { formatScopedIdentityName } from "@/lib/identity-scopes";

export type AuditActorDirectoryKind = "service_account" | "user";

export type AuditActorCandidate = {
	details: string[];
	id: number;
	identityScope: string;
	kind: AuditActorDirectoryKind;
	name: string;
};

export function isAuditActorDirectoryKind(
	value: string,
): value is AuditActorDirectoryKind {
	return value === "user" || value === "service_account";
}

export function userAuditActorCandidate(
	user: Pick<
		UserResponse,
		"email" | "id" | "identity_scope" | "name" | "proper_name"
	>,
): AuditActorCandidate {
	return {
		details: [user.proper_name, user.email].filter(
			(value): value is string => Boolean(value?.trim()),
		),
		id: user.id,
		identityScope: user.identity_scope,
		kind: "user",
		name: user.name,
	};
}

export function serviceAccountAuditActorCandidate(
	account: Pick<
		ServiceAccountResponse,
		"description" | "id" | "identity_scope" | "name"
	>,
): AuditActorCandidate {
	return {
		details: account.description.trim() ? [account.description] : [],
		id: account.id,
		identityScope: account.identity_scope,
		kind: "service_account",
		name: account.name,
	};
}

export function formatAuditActorCandidate(
	candidate: AuditActorCandidate,
): string {
	const details = candidate.details.length
		? ` · ${candidate.details.join(" · ")}`
		: "";
	return `${formatScopedIdentityName(candidate.identityScope, candidate.name)} (#${candidate.id})${details}`;
}

export function auditActorCandidateInputValue(
	candidate: AuditActorCandidate,
): string {
	return formatScopedIdentityName(candidate.identityScope, candidate.name);
}

export function getAuditActorSearchTerm(input: string): string {
	const identity = input.trim().split(" (#", 1)[0];
	return identity.slice(identity.lastIndexOf("/") + 1).trim();
}

export function auditActorCandidateMatches(
	candidate: AuditActorCandidate,
	search: string,
): boolean {
	const normalized = search.trim().toLowerCase();
	if (!normalized) return true;

	return [
		candidate.name,
		formatScopedIdentityName(candidate.identityScope, candidate.name),
		String(candidate.id),
		...candidate.details,
	].some((value) => value.toLowerCase().includes(normalized));
}

export function resolveAuditActorCandidate(
	input: string,
	candidates: readonly AuditActorCandidate[],
): AuditActorCandidate | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	const normalized = trimmed.toLowerCase();
	const exactOption = candidates.find(
		(candidate) => formatAuditActorCandidate(candidate).toLowerCase() === normalized,
	);
	if (exactOption) return exactOption;

	const idMatch = normalized.match(/#(\d+)\)/);
	const id = idMatch
		? Number.parseInt(idMatch[1], 10)
		: /^\d+$/.test(trimmed)
			? Number.parseInt(trimmed, 10)
			: null;
	if (id != null) {
		return candidates.find((candidate) => candidate.id === id) ?? null;
	}

	const exactMatches = candidates.filter((candidate) =>
		[
			candidate.name,
			auditActorCandidateInputValue(candidate),
			...candidate.details,
		].some((value) => value.toLowerCase() === normalized),
	);
	return exactMatches.length === 1 ? exactMatches[0] : null;
}
