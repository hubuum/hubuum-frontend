import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassIdSchemaRevisionsByRevision,
	deleteApiV1ClassesByClassIdSchemaTasksByTaskId,
	getApiV1ClassesByClassIdSchema,
	getApiV1ClassesByClassIdSchemaObjects,
	getApiV1ClassesByClassIdSchemaRevisionsByRevision,
	getApiV1ClassesByClassIdSchemaTasksByTaskId,
	getGetApiV1ClassesByClassIdSchemaRevisionsUrl,
	postApiV1ClassesByClassIdSchemaRevisions,
	postApiV1ClassesByClassIdSchemaRevisionsByRevisionActivate,
	postApiV1ClassesByClassIdSchemaRevisionsByRevisionImpact,
	postApiV1ClassesByClassIdSchemaRevisionsByRevisionRevalidate,
} from "@/lib/api/generated/client";
import type {
	ComplianceStatus,
	SchemaActivationRequest,
	SchemaRevisionResponse,
	SchemaStageRequest,
} from "@/lib/api/generated/models";

export const SCHEMA_PAGE_SIZE = 50;

export class SchemaApiError extends Error {
	constructor(
		public readonly status: number,
		data: unknown,
	) {
		super(
			getApiErrorMessage(data, "The schema request failed. Please try again."),
		);
	}
}

function options(signal?: AbortSignal): RequestInit {
	return { credentials: "include", signal };
}

export async function supportsSchemaRevisions(
	classId: number,
	signal?: AbortSignal,
) {
	const response = await fetch(
		getGetApiV1ClassesByClassIdSchemaRevisionsUrl(classId, { limit: 1 }),
		options(signal),
	);
	if (response.status === 404) return false;
	const data: unknown = await response.json().catch(() => null);
	if (response.status !== 200) throw new SchemaApiError(response.status, data);
	if (!Array.isArray(data))
		throw new Error("The server returned an invalid schema revision list.");
	return true;
}

export async function fetchSchemaRevisions(
	classId: number,
	after = 0,
	signal?: AbortSignal,
) {
	const response = await fetch(
		getGetApiV1ClassesByClassIdSchemaRevisionsUrl(classId, {
			after,
			limit: SCHEMA_PAGE_SIZE,
		}),
		options(signal),
	);
	const data: unknown = await response.json().catch(() => null);
	if (response.status !== 200) throw new SchemaApiError(response.status, data);
	if (!Array.isArray(data))
		throw new Error("The server returned an invalid schema revision list.");
	return data as SchemaRevisionResponse[];
}

// The summary is administrator-only. Revision reads also serve class readers.
export async function fetchSchemaSummary(
	classId: number,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdSchema(
		classId,
		options(signal),
	);
	if (response.status === 403) return null;
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function fetchActiveSchema(classId: number, signal?: AbortSignal) {
	let after = 0;
	while (true) {
		const revisions = await fetchSchemaRevisions(classId, after, signal);
		const active = revisions.find((revision) => revision.status === "active");
		if (active) return active;
		const next = revisions.at(-1)?.revision;
		if (
			revisions.length < SCHEMA_PAGE_SIZE ||
			next === undefined ||
			next <= after
		) {
			throw new Error(
				"The server did not return an active schema revision. Refresh to try again.",
			);
		}
		after = next;
	}
}

export async function fetchSchemaRevision(
	classId: number,
	revision: number,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdSchemaRevisionsByRevision(
		classId,
		revision,
		options(signal),
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function stageSchema(
	classId: number,
	payload: SchemaStageRequest,
) {
	const response = await postApiV1ClassesByClassIdSchemaRevisions(
		classId,
		payload,
		options(),
	);
	if (response.status !== 201)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function abandonSchema(classId: number, revision: number) {
	const response = await deleteApiV1ClassesByClassIdSchemaRevisionsByRevision(
		classId,
		revision,
		options(),
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function activateSchema(
	classId: number,
	revision: number,
	payload: SchemaActivationRequest,
) {
	const response =
		await postApiV1ClassesByClassIdSchemaRevisionsByRevisionActivate(
			classId,
			revision,
			payload,
			options(),
		);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function startSchemaWork(
	classId: number,
	revision: number,
	kind: "impact" | "revalidation",
) {
	const response =
		kind === "impact"
			? await postApiV1ClassesByClassIdSchemaRevisionsByRevisionImpact(
					classId,
					revision,
					options(),
				)
			: await postApiV1ClassesByClassIdSchemaRevisionsByRevisionRevalidate(
					classId,
					revision,
					options(),
				);
	if (response.status !== 202)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function fetchSchemaWork(
	classId: number,
	taskId: number,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdSchemaTasksByTaskId(
		classId,
		taskId,
		options(signal),
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function cancelSchemaWork(classId: number, taskId: number) {
	const response = await deleteApiV1ClassesByClassIdSchemaTasksByTaskId(
		classId,
		taskId,
		options(),
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}

export async function fetchSchemaCompliance(
	classId: number,
	after = 0,
	status?: ComplianceStatus,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdSchemaObjects(
		classId,
		{ after, limit: SCHEMA_PAGE_SIZE, status },
		options(signal),
	);
	if (response.status !== 200)
		throw new SchemaApiError(response.status, response.data);
	return response.data;
}
