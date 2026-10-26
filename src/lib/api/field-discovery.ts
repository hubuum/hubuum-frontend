import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1ClassesByClassIdFields } from "@/lib/api/generated/client";
import type { GetApiV1ClassesByClassIdFieldsParams } from "@/lib/api/generated/models";

export const DEFAULT_FIELD_DISCOVERY = {
	limit: 100,
	depth: 6,
	containers: true,
} as const;

export function classFieldInventoryQueryKey(
	classId: number | null,
	options: GetApiV1ClassesByClassIdFieldsParams = DEFAULT_FIELD_DISCOVERY,
) {
	return ["class-field-inventory", classId, options] as const;
}

export async function fetchClassFieldInventory(
	classId: number,
	options: GetApiV1ClassesByClassIdFieldsParams = DEFAULT_FIELD_DISCOVERY,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdFields(classId, options, {
		credentials: "include",
		signal,
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not discover fields for this class.",
			),
		);
	}
	return response.data;
}
