import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import {
	getApiV1Classes,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	Collection,
	HubuumClassExpanded,
	HubuumObject,
} from "@/lib/api/generated/models";

export const RESOURCE_DIRECTORY_LIMIT = 50;
const RESOURCE_ID_BATCH_LIMIT = 250;

export type ResourceDirectory<T> = {
	items: T[];
	isPartial: boolean;
};

function directorySearchParams(query: string) {
	const trimmedQuery = query.trim();
	const filter = /^\d+$/.test(trimmedQuery)
		? { id__in: trimmedQuery }
		: { name__icontains: trimmedQuery };
	return {
		...filter,
		include_total: false,
		limit: RESOURCE_DIRECTORY_LIMIT,
		sort: "name.asc,id.asc",
	};
}

export async function fetchCollectionDirectory(
	query: string,
): Promise<ResourceDirectory<Collection>> {
	// Collection list handlers accept shared dynamic filters beyond the generated
	// pagination-only parameter type.
	const response = await getApiV1Collections(directorySearchParams(query), {
		credentials: "include",
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Collection lookup is unavailable."),
		);
	}
	return {
		items: response.data,
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}

export async function fetchCollectionsByExactName(
	name: string,
): Promise<Collection[]> {
	const normalizedName = name.trim().toLocaleLowerCase();
	if (!normalizedName) return [];

	const collections = await collectAllCursorPages(async (cursor) => {
		// Collection list handlers accept shared dynamic filters beyond the
		// generated pagination-only parameter type.
		const params = {
			name__icontains: name.trim(),
			include_total: false,
			limit: 250,
			sort: "name.asc,id.asc",
			cursor,
		};
		const response = await getApiV1Collections(params, {
			credentials: "include",
		});
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Collection lookup is unavailable."),
			);
		}
		return {
			items: response.data,
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});

	return collections.filter(
		(collection) =>
			collection.name.trim().toLocaleLowerCase() === normalizedName,
	);
}

export async function fetchCollectionsByIds(
	ids: readonly number[],
): Promise<Collection[]> {
	if (!ids.length) return [];
	const batches = Array.from(
		{ length: Math.ceil(ids.length / RESOURCE_ID_BATCH_LIMIT) },
		(_, index) =>
			ids.slice(
				index * RESOURCE_ID_BATCH_LIMIT,
				(index + 1) * RESOURCE_ID_BATCH_LIMIT,
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
			return getApiV1Collections(params, { credentials: "include" });
		}),
	);
	return responses.flatMap((response) => {
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Collection lookup is unavailable."),
			);
		}
		return response.data;
	});
}

export async function fetchClassDirectory(
	query: string,
): Promise<ResourceDirectory<HubuumClassExpanded>> {
	const response = await getApiV1Classes(directorySearchParams(query), {
		credentials: "include",
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Class lookup is unavailable."),
		);
	}
	return {
		items: response.data,
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}

export async function fetchCollectionClassDirectory(
	collectionId: number,
	query: string,
): Promise<ResourceDirectory<HubuumClassExpanded>> {
	const params = {
		...directorySearchParams(query),
		collection_id: collectionId,
	};
	const response = await getApiV1Classes(params, {
		credentials: "include",
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Class lookup is unavailable."),
		);
	}
	return {
		items: response.data,
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}

export async function fetchClassesByIds(
	ids: readonly number[],
): Promise<HubuumClassExpanded[]> {
	if (!ids.length) return [];
	const batches = Array.from(
		{ length: Math.ceil(ids.length / RESOURCE_ID_BATCH_LIMIT) },
		(_, index) =>
			ids.slice(
				index * RESOURCE_ID_BATCH_LIMIT,
				(index + 1) * RESOURCE_ID_BATCH_LIMIT,
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
			return getApiV1Classes(params, { credentials: "include" });
		}),
	);
	return responses.flatMap((response) => {
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Class lookup is unavailable."),
			);
		}
		return response.data;
	});
}

export async function fetchClassObjectDirectory(
	classId: number,
	query: string,
): Promise<ResourceDirectory<HubuumObject>> {
	const trimmedQuery = query.trim();
	const params = new URLSearchParams({
		include_total: "false",
		limit: String(RESOURCE_DIRECTORY_LIMIT),
		sort: "name.asc,id.asc",
	});
	if (/^\d+$/.test(trimmedQuery)) {
		params.set("id__in", trimmedQuery);
	} else {
		params.set("name__icontains", trimmedQuery);
	}

	const response = await fetch(
		`${frontendApiPath(`/classes/${classId}/objects`)}?${params.toString()}`,
		{ credentials: "include" },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Object lookup is unavailable."),
		);
	}
	return {
		items: expectArrayPayload<HubuumObject>(payload, "object directory"),
		isPartial: Boolean(response.headers.get("x-next-cursor")),
	};
}
