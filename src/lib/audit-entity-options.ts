export type AuditEntityDirectoryKind =
	| "class"
	| "collection"
	| "group"
	| "object"
	| "remote_target"
	| "service_account"
	| "template"
	| "user";

export type AuditEntityCandidate = {
	details: string[];
	id: number;
	inputValue: string;
	kind: AuditEntityDirectoryKind;
	name: string;
};

export function isAuditEntityDirectoryKind(
	value: string,
): value is AuditEntityDirectoryKind {
	return (
		value === "class" ||
		value === "collection" ||
		value === "group" ||
		value === "object" ||
		value === "remote_target" ||
		value === "service_account" ||
		value === "template" ||
		value === "user"
	);
}

export function auditEntityCandidateMatches(
	candidate: AuditEntityCandidate,
	search: string,
): boolean {
	const normalized = search.trim().toLowerCase();
	if (!normalized) return true;

	return [
		candidate.name,
		candidate.inputValue,
		String(candidate.id),
		...candidate.details,
	].some((value) => value.toLowerCase().includes(normalized));
}

export function resolveAuditEntityCandidate(
	input: string,
	candidates: readonly AuditEntityCandidate[],
): AuditEntityCandidate | null {
	const normalized = input.trim().toLowerCase();
	if (!normalized) return null;

	const matches = candidates.filter((candidate) =>
		[candidate.name, candidate.inputValue, String(candidate.id)].some(
			(value) => value.toLowerCase() === normalized,
		),
	);
	return matches.length === 1 ? matches[0] : null;
}
