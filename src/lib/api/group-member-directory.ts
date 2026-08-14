import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamServiceAccounts,
	getApiV1IamUsers,
} from "@/lib/api/generated/client";
import {
	type GroupMembershipCandidate,
	humanMembershipCandidate,
	serviceAccountMembershipCandidate,
} from "@/lib/group-membership-candidates";

const GROUP_MEMBER_SEARCH_LIMIT_PER_KIND = 25;

export type GroupMemberDirectory = {
	candidates: GroupMembershipCandidate[];
	isPartial: boolean;
	unavailableKinds: Array<"human" | "service_account">;
};

function searchParams(query: string) {
	const filter = /^\d+$/.test(query)
		? { id__in: query }
		: { name__icontains: query };
	return {
		...filter,
		include_total: false,
		limit: GROUP_MEMBER_SEARCH_LIMIT_PER_KIND,
		sort: "name.asc,id.asc",
	};
}

export async function fetchGroupMemberDirectory(
	query: string,
): Promise<GroupMemberDirectory> {
	const params = searchParams(query.trim());
	const kinds = ["human", "service_account"] as const;
	const results = await Promise.allSettled([
		getApiV1IamUsers(params, { credentials: "include" }).then((response) => {
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "User lookup is unavailable."),
				);
			}
			return {
				candidates: response.data.map(humanMembershipCandidate),
				isPartial: Boolean(response.headers.get("x-next-cursor")),
			};
		}),
		getApiV1IamServiceAccounts(params, { credentials: "include" }).then(
			(response) => {
				if (response.status !== 200) {
					throw new Error(
						getApiErrorMessage(
							response.data,
							"Service-account lookup is unavailable.",
						),
					);
				}
				return {
					candidates: response.data.map(serviceAccountMembershipCandidate),
					isPartial: Boolean(response.headers.get("x-next-cursor")),
				};
			},
		),
	]);
	const availableDirectories = results.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	if (!availableDirectories.length) {
		throw new Error("Member lookup is unavailable.");
	}

	return {
		candidates: availableDirectories
			.flatMap((directory) => directory.candidates)
			.sort(
				(left, right) =>
					left.name.localeCompare(right.name) || left.id - right.id,
			),
		isPartial: availableDirectories.some((directory) => directory.isPartial),
		unavailableKinds: kinds.filter(
			(_kind, index) => results[index].status === "rejected",
		),
	};
}
