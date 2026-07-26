import type { ConsoleServiceAccount, ConsoleUser } from "@/lib/identity-scopes";
import { formatScopedIdentityName } from "@/lib/identity-scopes";

export type GroupMembershipCandidate = {
	detail: string | null;
	id: number;
	identityScope: string | null | undefined;
	kind: "human" | "service_account";
	name: string;
};

export function humanMembershipCandidate(
	user: Pick<ConsoleUser, "email" | "id" | "identity_scope" | "name">,
): GroupMembershipCandidate {
	return {
		detail: user.email ?? null,
		id: user.id,
		identityScope: user.identity_scope,
		kind: "human",
		name: user.name,
	};
}

export function serviceAccountMembershipCandidate(
	account: Pick<
		ConsoleServiceAccount,
		"description" | "id" | "identity_scope" | "name"
	>,
): GroupMembershipCandidate {
	return {
		detail: account.description ?? null,
		id: account.id,
		identityScope: account.identity_scope,
		kind: "service_account",
		name: account.name,
	};
}

export function groupMembershipCandidateKindLabel(
	candidate: Pick<GroupMembershipCandidate, "kind">,
): string {
	return candidate.kind === "service_account" ? "Service account" : "Human";
}

export function formatGroupMembershipCandidateOption(
	candidate: GroupMembershipCandidate,
): string {
	const detail = candidate.detail ? ` · ${candidate.detail}` : "";
	return `${formatScopedIdentityName(candidate.identityScope, candidate.name)} (#${candidate.id}) · ${groupMembershipCandidateKindLabel(candidate)}${detail}`;
}

export function groupMembershipCandidateMatches(
	candidate: GroupMembershipCandidate,
	search: string,
): boolean {
	const normalized = search.trim().toLowerCase();
	if (!normalized) {
		return true;
	}

	return [
		candidate.name,
		formatScopedIdentityName(candidate.identityScope, candidate.name),
		String(candidate.id),
		candidate.detail ?? "",
		groupMembershipCandidateKindLabel(candidate),
	].some((value) => value.toLowerCase().includes(normalized));
}

export function resolveGroupMembershipCandidate(
	input: string,
	availableCandidates: GroupMembershipCandidate[],
): GroupMembershipCandidate | null {
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	const normalized = trimmed.toLowerCase();
	const exactOption = availableCandidates.find(
		(candidate) =>
			formatGroupMembershipCandidateOption(candidate).toLowerCase() ===
			normalized,
	);
	if (exactOption) {
		return exactOption;
	}

	const extractedIdMatch = normalized.match(/#(\d+)\)/);
	const parsedId = extractedIdMatch
		? Number.parseInt(extractedIdMatch[1], 10)
		: Number.parseInt(trimmed, 10);
	if (Number.isFinite(parsedId)) {
		const matchedById = availableCandidates.find(
			(candidate) => candidate.id === parsedId,
		);
		if (matchedById) {
			return matchedById;
		}
	}

	const matchedByScopedName = availableCandidates.filter(
		(candidate) =>
			formatScopedIdentityName(
				candidate.identityScope,
				candidate.name,
			).toLowerCase() === normalized,
	);
	if (matchedByScopedName.length === 1) {
		return matchedByScopedName[0];
	}

	const matchedByName = availableCandidates.filter(
		(candidate) => candidate.name.toLowerCase() === normalized,
	);
	if (matchedByName.length === 1) {
		return matchedByName[0];
	}

	const matchedByDetail = availableCandidates.filter(
		(candidate) => (candidate.detail ?? "").toLowerCase() === normalized,
	);
	return matchedByDetail.length === 1 ? matchedByDetail[0] : null;
}
