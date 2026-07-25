import type { Provenance } from "@/lib/api/generated/models";

type CompatibleProvenanceRecord = {
	actor_kind?: string | null;
	actor_user_id?: number | null;
	initiator_user_id?: number | null;
	provenance?: Provenance | null;
};

function formatPrincipal(
	principal: { name?: string | null; principal_id: number },
	label: string,
): string {
	return principal.name
		? `${principal.name} (#${principal.principal_id})`
		: `${label} #${principal.principal_id}`;
}

export function formatEventActor(record: CompatibleProvenanceRecord): string {
	const provenanceActor = record.provenance?.actor;
	const actorKind =
		provenanceActor?.kind?.trim() || record.actor_kind?.trim() || "";
	if (provenanceActor?.principal) {
		return formatPrincipal(provenanceActor.principal, actorKind || "Principal");
	}
	if (record.actor_user_id != null) {
		return `${actorKind || "Actor"} #${record.actor_user_id}`;
	}
	return actorKind || "n/a";
}

export function formatEventInitiator(
	record: CompatibleProvenanceRecord,
): string {
	const initiator = record.provenance?.initiator;
	if (initiator) {
		return formatPrincipal(initiator, "Principal");
	}
	if (record.initiator_user_id != null) {
		return `Principal #${record.initiator_user_id}`;
	}
	return "n/a";
}

export function getProvenanceTaskId(
	record: CompatibleProvenanceRecord,
): number | null {
	return record.provenance?.task_id ?? null;
}
