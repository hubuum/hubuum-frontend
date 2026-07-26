import {
	getApiV1ClassesByClassIdByObjectId,
	getApiV1ClassesByClassId,
	getApiV1CollectionsByCollectionId,
} from "@/lib/api/generated/client";
import type { TokenResourceScope } from "@/lib/api/generated/models";
import { tokenResourceScopeKey } from "@/lib/token-resource-scope-selection";

export type TokenResourceNameMap = Record<string, string>;

const DIRECT_LOOKUP_CONCURRENCY = 8;

async function runWithConcurrency<T>(
	items: readonly T[],
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	const workerCount = Math.min(items.length, DIRECT_LOOKUP_CONCURRENCY);

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const item = items[nextIndex];
				nextIndex += 1;
				await worker(item);
			}
		}),
	);
}

export async function resolveDirectTokenResourceNames(
	resources: readonly TokenResourceScope[],
	signal?: AbortSignal,
): Promise<TokenResourceNameMap> {
	const uniqueResources = [
		...new Map(
			resources
				.filter((resource) => resource.kind !== "object")
				.map((resource) => [tokenResourceScopeKey(resource), resource]),
		).values(),
	];
	const names: TokenResourceNameMap = {};

	await runWithConcurrency(uniqueResources, async (resource) => {
		try {
			const response =
				resource.kind === "collection"
					? await getApiV1CollectionsByCollectionId(resource.id, {
							credentials: "include",
							signal,
						})
					: await getApiV1ClassesByClassId(resource.id, {
							credentials: "include",
							signal,
						});

			if (response.status === 200) {
				names[tokenResourceScopeKey(resource)] = response.data.name;
			}
		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
		}
	});

	return names;
}

export async function resolveObjectTokenResourceNames(
	resources: readonly TokenResourceScope[],
	signal?: AbortSignal,
): Promise<TokenResourceNameMap> {
	const objectResources = [
		...new Map(
			resources
				.filter((resource) => resource.kind === "object")
				.map((resource) => [tokenResourceScopeKey(resource), resource]),
		).values(),
	];
	const classIds = [
		...new Set(
			resources
				.filter((resource) => resource.kind === "class")
				.map((resource) => resource.id),
		),
	];
	const names: TokenResourceNameMap = {};

	await runWithConcurrency(objectResources, async (resource) => {
		for (const classId of classIds) {
			try {
				const response = await getApiV1ClassesByClassIdByObjectId(
					classId,
					resource.id,
					undefined,
					{
						credentials: "include",
						signal,
					},
				);

				if (response.status === 200) {
					names[tokenResourceScopeKey(resource)] = response.data.name;
					return;
				}
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
			}
		}
	});

	return names;
}
