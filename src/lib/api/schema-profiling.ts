import {
	getApiV1ClassesByClassIdSchemaProfilesByTaskId,
	postApiV1ClassesByClassIdSchemaProfiles,
} from "@/lib/api/generated/client";
import type { SchemaProfileRequest } from "@/lib/api/generated/models";
import { SchemaApiError } from "@/lib/api/schema-evolution";
import { acquireOperationIdempotencyKey } from "@/lib/operation-idempotency";

export async function submitSchemaProfile(
	classId: number,
	request: SchemaProfileRequest,
) {
	const idempotency = await acquireOperationIdempotencyKey(
		`schema-profile:${classId}`,
		request,
	);
	const response = await postApiV1ClassesByClassIdSchemaProfiles(
		classId,
		request,
		{
			credentials: "include",
			headers: { "Idempotency-Key": idempotency.key },
		},
	);
	if (response.status !== 202)
		throw new SchemaApiError(response.status, response.data);
	idempotency.complete();
	return response.data;
}

export async function fetchSchemaProfile(
	classId: number,
	taskId: number,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdSchemaProfilesByTaskId(
		classId,
		taskId,
		{
			credentials: "include",
			signal,
		},
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}
