import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getDeleteApiV1ClassesByClassIdQueryUsageByDeclarationIdUrl,
	getGetApiV1ClassesByClassIdQueryUsageUrl,
	getPostApiV1ClassesByClassIdQueryUsageAnalysisUrl,
	getPostApiV1ClassesByClassIdQueryUsageUrl,
	getPutApiV1ClassesByClassIdQueryUsageByDeclarationIdUrl,
} from "@/lib/api/generated/client";
import type {
	QueryUsageAnalysisRequest,
	QueryUsageAnalysisResponse,
	QueryUsageCreateRequest,
	QueryUsagePatternSchema,
	QueryUsageReplaceRequest,
	QueryUsageResponse,
} from "@/lib/api/generated/models";

export class QueryUsageApiError extends Error {
	constructor(
		public readonly status: number,
		data: unknown,
	) {
		super(getApiErrorMessage(data, "The query usage request failed."));
	}
}

async function request<T>(
	url: string,
	status: number,
	options: RequestInit,
): Promise<T> {
	const response = await fetch(url, { credentials: "include", ...options });
	const text = await response.text();
	let data: unknown;
	try {
		data = text ? JSON.parse(text) : undefined;
	} catch {
		// Older servers can return a plain-text 404 for unsupported endpoints.
		if (response.status === status)
			throw new Error("The server returned invalid query usage data.");
	}
	if (response.status !== status)
		throw new QueryUsageApiError(response.status, data);
	return data as T;
}

export function fetchQueryUsage(classId: number, signal?: AbortSignal) {
	return request<QueryUsageResponse[]>(
		getGetApiV1ClassesByClassIdQueryUsageUrl(classId),
		200,
		{ method: "GET", signal },
	);
}

export function createQueryUsage(
	classId: number,
	pattern: QueryUsagePatternSchema,
) {
	return request<QueryUsageResponse>(
		getPostApiV1ClassesByClassIdQueryUsageUrl(classId),
		201,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pattern } satisfies QueryUsageCreateRequest),
		},
	);
}

export function replaceQueryUsage(
	classId: number,
	declaration: QueryUsageResponse,
	pattern: QueryUsagePatternSchema,
) {
	return request<QueryUsageResponse>(
		getPutApiV1ClassesByClassIdQueryUsageByDeclarationIdUrl(
			classId,
			declaration.id,
		),
		200,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				pattern,
				expected_revision: declaration.revision,
			} satisfies QueryUsageReplaceRequest),
		},
	);
}

export function deleteQueryUsage(
	classId: number,
	declaration: QueryUsageResponse,
) {
	return request<void>(
		getDeleteApiV1ClassesByClassIdQueryUsageByDeclarationIdUrl(
			classId,
			declaration.id,
			{ expected_revision: declaration.revision },
		),
		204,
		{ method: "DELETE" },
	);
}

export function analyzeQueryUsage(
	classId: number,
	proposed: QueryUsagePatternSchema[],
	signal?: AbortSignal,
) {
	return request<QueryUsageAnalysisResponse>(
		getPostApiV1ClassesByClassIdQueryUsageAnalysisUrl(classId),
		200,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal,
			body: JSON.stringify({ proposed } satisfies QueryUsageAnalysisRequest),
		},
	);
}
