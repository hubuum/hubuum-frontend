import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamServiceAccounts,
	getApiV1IamUsers,
} from "@/lib/api/generated/client";
import {
	type AuditActorCandidate,
	type AuditActorDirectoryKind,
	serviceAccountAuditActorCandidate,
	userAuditActorCandidate,
} from "@/lib/audit-actor-options";

export const AUDIT_ACTOR_SEARCH_LIMIT = 50;

export type AuditActorDirectory = {
	candidates: AuditActorCandidate[];
	isPartial: boolean;
};

export async function fetchAuditActorDirectory(
	kind: AuditActorDirectoryKind,
	nameContains: string,
): Promise<AuditActorDirectory> {
	// IAM list handlers accept the shared dynamic filters even though OpenAPI only
	// exposes their pagination parameters in the generated TypeScript types.
	const params = {
		include_total: false,
		limit: AUDIT_ACTOR_SEARCH_LIMIT,
		name__icontains: nameContains,
		sort: "name.asc,id.asc",
	};

	if (kind === "user") {
		const response = await getApiV1IamUsers(params, {
			credentials: "include",
		});
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "User lookup is unavailable."),
			);
		}
		return {
			candidates: response.data.map(userAuditActorCandidate),
			isPartial: Boolean(response.headers.get("x-next-cursor")),
		};
	}

	const response = await getApiV1IamServiceAccounts(params, {
		credentials: "include",
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Service-account lookup is unavailable.",
			),
		);
	}
	return {
		candidates: response.data.map(serviceAccountAuditActorCandidate),
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}
