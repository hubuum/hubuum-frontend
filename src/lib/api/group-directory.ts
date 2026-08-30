import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamGroups } from "@/lib/api/generated/client";
import type { ResourceDirectory } from "@/lib/api/resource-directory";
import type { ConsoleGroup } from "@/lib/identity-scopes";

export const GROUP_DIRECTORY_LIMIT = 50;
const GROUP_ID_BATCH_LIMIT = 250;

export async function fetchGroupDirectory(
	query: string,
): Promise<ResourceDirectory<ConsoleGroup>> {
	const trimmedQuery = query.trim();
	const filter = /^\d+$/.test(trimmedQuery)
		? { id__in: trimmedQuery }
		: { name__icontains: trimmedQuery };
	// IAM list handlers accept shared dynamic filters beyond the generated
	// pagination-only parameter type.
	const response = await getApiV1IamGroups(
		{
			...filter,
			include_total: false,
			limit: GROUP_DIRECTORY_LIMIT,
			sort: "name.asc,id.asc",
		},
		{ credentials: "include" },
	);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Group lookup is unavailable."),
		);
	}
	return {
		items: response.data,
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}

export async function fetchGroupsByIds(
	ids: readonly number[],
): Promise<ConsoleGroup[]> {
	if (!ids.length) return [];
	const batches = Array.from(
		{ length: Math.ceil(ids.length / GROUP_ID_BATCH_LIMIT) },
		(_, index) =>
			ids.slice(
				index * GROUP_ID_BATCH_LIMIT,
				(index + 1) * GROUP_ID_BATCH_LIMIT,
			),
	);
	const responses = await Promise.all(
		batches.map((batch) => {
			const params = {
				id__in: batch.join(","),
				include_total: false,
				limit: batch.length,
				sort: "id.asc",
			};
			return getApiV1IamGroups(params, { credentials: "include" });
		}),
	);
	return responses.flatMap((response) => {
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Group lookup is unavailable."),
			);
		}
		return response.data;
	});
}

export async function fetchAllGroups(): Promise<ConsoleGroup[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1IamGroups(
			{
				cursor,
				include_total: false,
				limit: 250,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Group lookup is unavailable."),
			);
		}
		return {
			items: response.data,
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});
}
