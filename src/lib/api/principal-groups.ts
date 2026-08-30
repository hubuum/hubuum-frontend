import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMeGroups,
	getApiV1IamPrincipalsByPrincipalIdGroups,
} from "@/lib/api/generated/client";
import type { ConsoleGroup } from "@/lib/identity-scopes";

export async function fetchCurrentPrincipalGroups(): Promise<ConsoleGroup[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1IamMeGroups(
			{ cursor, include_total: false, limit: 250, sort: "id.asc" },
			{ credentials: "include" },
		);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load groups."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}

export async function fetchPrincipalGroups(
	principalId: number,
): Promise<ConsoleGroup[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1IamPrincipalsByPrincipalIdGroups(
			principalId,
			{ cursor, include_total: false, limit: 250, sort: "id.asc" },
			{ credentials: "include" },
		);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load principal groups."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}

export function hasAnyGroupMembership(
	principalGroups: readonly ConsoleGroup[],
	accessGroups: readonly Pick<ConsoleGroup, "id">[] | undefined,
): boolean {
	const principalGroupIds = new Set(principalGroups.map((group) => group.id));
	return (accessGroups ?? []).some((group) => principalGroupIds.has(group.id));
}
