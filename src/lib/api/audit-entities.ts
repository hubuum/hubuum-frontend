import { fetchAuditActorDirectory } from "@/lib/api/audit-actors";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1ExportTemplates,
	getApiV1IamGroups,
	getApiV1RemoteTargets,
} from "@/lib/api/generated/client";
import { fetchUnifiedSearchKindPage } from "@/lib/api/search";
import { auditActorCandidateInputValue } from "@/lib/audit-actor-options";
import {
	type AuditEntityCandidate,
	type AuditEntityDirectoryKind,
} from "@/lib/audit-entity-options";
import { formatScopedIdentityName } from "@/lib/identity-scopes";

export const AUDIT_ENTITY_SEARCH_LIMIT = 50;

export type AuditEntityDirectory = {
	candidates: AuditEntityCandidate[];
	isPartial: boolean;
};

export async function fetchAuditEntityDirectory(
	kind: AuditEntityDirectoryKind,
	query: string,
): Promise<AuditEntityDirectory> {
	if (kind === "user" || kind === "service_account") {
		const directory = await fetchAuditActorDirectory(
			kind,
			query,
			AUDIT_ENTITY_SEARCH_LIMIT,
		);
		return {
			candidates: directory.candidates.map((candidate) => ({
				details: candidate.details,
				id: candidate.id,
				inputValue: auditActorCandidateInputValue(candidate),
				kind,
				name: candidate.name,
			})),
			isPartial: directory.isPartial,
		};
	}

	if (kind === "group") {
		// IAM list handlers support shared dynamic filters beyond their generated
		// pagination-only parameter types.
		const params = {
			include_total: false,
			limit: AUDIT_ENTITY_SEARCH_LIMIT,
			name__icontains: query,
			sort: "id.asc",
		};
		const response = await getApiV1IamGroups(params, {
			credentials: "include",
		});
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Group lookup is unavailable."),
			);
		}
		return {
			candidates: response.data.map((group) => ({
				details: group.description.trim() ? [group.description] : [],
				id: group.id,
				inputValue: formatScopedIdentityName(
					group.identity_scope,
					group.groupname,
				),
				kind,
				name: group.groupname,
			})),
			isPartial: Boolean(response.headers.get("x-next-cursor")),
		};
	}

	if (kind === "template" || kind === "remote_target") {
		// These list handlers use the same shared dynamic filters as IAM lists.
		const params = {
			include_total: false,
			limit: AUDIT_ENTITY_SEARCH_LIMIT,
			name__icontains: query,
			sort: "name.asc,id.asc",
		};
		const response =
			kind === "template"
				? await getApiV1ExportTemplates(params, { credentials: "include" })
				: await getApiV1RemoteTargets(params, { credentials: "include" });
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(
					response.data,
					kind === "template"
						? "Template lookup is unavailable."
						: "Remote-target lookup is unavailable.",
				),
			);
		}
		return {
			candidates: response.data.map((entity) => ({
				details: [
					`Collection #${entity.collection_id}`,
					...(entity.description.trim() ? [entity.description] : []),
				],
				id: entity.id,
				inputValue: entity.name,
				kind,
				name: entity.name,
			})),
			isPartial: Boolean(response.headers.get("x-next-cursor")),
		};
	}

	const page = await fetchUnifiedSearchKindPage({
		kind,
		q: query,
		limitPerKind: AUDIT_ENTITY_SEARCH_LIMIT,
	});
	if (page.kind === "collection") {
		return {
			candidates: page.results.map((collection) => ({
				details: collection.description.trim() ? [collection.description] : [],
				id: collection.id,
				inputValue: collection.name,
				kind,
				name: collection.name,
			})),
			isPartial: Boolean(page.next),
		};
	}
	if (page.kind === "class") {
		return {
			candidates: page.results.map((hubuumClass) => ({
				details: [
					`Collection · ${hubuumClass.collection.name} (#${hubuumClass.collection.id})`,
					...(hubuumClass.description.trim() ? [hubuumClass.description] : []),
				],
				id: hubuumClass.id,
				inputValue: hubuumClass.name,
				kind,
				name: hubuumClass.name,
			})),
			isPartial: Boolean(page.next),
		};
	}
	return {
		candidates: page.results.map((object) => ({
			details: [
				`Class #${object.hubuum_class_id} · Collection #${object.collection_id}`,
				...(object.description.trim() ? [object.description] : []),
			],
			id: object.id,
			inputValue: object.name,
			kind,
			name: object.name,
		})),
		isPartial: Boolean(page.next),
	};
}
