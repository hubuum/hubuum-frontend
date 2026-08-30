import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1Classes,
	getApiV1Collections,
} from "@/lib/api/generated/client";
import type {
	Collection,
	HubuumClassExpanded,
} from "@/lib/api/generated/models";

const EXPORT_OPTION_LIMIT = 250;

export async function fetchExportCollections(): Promise<Collection[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1Collections(
			{
				cursor,
				include_total: false,
				limit: EXPORT_OPTION_LIMIT,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load collections."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}

export async function fetchExportClasses(): Promise<HubuumClassExpanded[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1Classes(
			{
				cursor,
				include_total: false,
				limit: EXPORT_OPTION_LIMIT,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load classes."),
			);
		}

		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}
