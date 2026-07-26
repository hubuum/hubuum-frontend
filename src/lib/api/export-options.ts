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
	const response = await getApiV1Collections(
		{ include_total: false, limit: EXPORT_OPTION_LIMIT },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load collections."),
		);
	}

	return response.data;
}

export async function fetchExportClasses(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ include_total: false, limit: EXPORT_OPTION_LIMIT },
		{ credentials: "include" },
	);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
	}

	return response.data;
}
