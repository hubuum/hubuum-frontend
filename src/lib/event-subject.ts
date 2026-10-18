import type { EventSubject } from "@/lib/api/generated/models";

export function eventSubject(metadata: unknown): EventSubject | null {
	if (!metadata || typeof metadata !== "object" || !("subject" in metadata))
		return null;
	const subject = metadata.subject;
	if (!subject || typeof subject !== "object") return null;
	if (
		!("principal_id" in subject) ||
		!Number.isSafeInteger(subject.principal_id) ||
		Number(subject.principal_id) <= 0 ||
		!("name" in subject) ||
		typeof subject.name !== "string" ||
		!("kind" in subject) ||
		(subject.kind !== "human" && subject.kind !== "service_account") ||
		!("identity_scope" in subject) ||
		typeof subject.identity_scope !== "string" ||
		!("authentication_provider_kind" in subject) ||
		typeof subject.authentication_provider_kind !== "string" ||
		!("is_admin" in subject) ||
		typeof subject.is_admin !== "boolean"
	)
		return null;
	return {
		principal_id: Number(subject.principal_id),
		name: subject.name,
		kind: subject.kind,
		identity_scope: subject.identity_scope,
		authentication_provider_kind: subject.authentication_provider_kind,
		is_admin: subject.is_admin,
	};
}
