import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1Search } from "@/lib/api/generated/client";
import type {
	StructuredSearchRequest,
	StructuredSearchResponse,
} from "@/lib/api/generated/models";

export async function fetchAdvancedSearch(
	request: StructuredSearchRequest,
	signal?: AbortSignal,
): Promise<StructuredSearchResponse> {
	const response = await postApiV1Search(request, {
		credentials: "include",
		signal,
	});
	if (response.status !== 200) {
		const fallback =
			response.status === 404 || Number(response.status) === 405
				? "This server does not support structured search. Ordinary search remains available."
				: response.status === 403
					? "You are not authorized to run this search."
					: "Could not run advanced search.";
		throw new Error(getApiErrorMessage(response.data, fallback));
	}
	return parseStructuredSearchResponse(response.data, request.target.kind);
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validResult(
	item: unknown,
	kind: StructuredSearchRequest["target"]["kind"],
): boolean {
	if (!record(item) || item.kind !== kind || !record(item.resource))
		return false;
	const resource = item.resource;
	if (!Number.isSafeInteger(resource.id) || Number(resource.id) < 1)
		return false;
	if (kind === "audit_event")
		return [
			"event_id",
			"summary",
			"occurred_at",
			"entity_type",
			"action",
			"actor_kind",
		].every((field) => typeof resource[field] === "string");
	if (typeof resource.updated_at !== "string") return false;
	if (kind === "group")
		return (
			typeof resource.groupname === "string" &&
			typeof resource.description === "string" &&
			typeof resource.identity_scope === "string"
		);
	if (typeof resource.name !== "string") return false;
	if (kind === "user") return typeof resource.identity_scope === "string";
	if (typeof resource.description !== "string") return false;
	if (kind === "class")
		return (
			record(resource.collection) &&
			Number.isSafeInteger(resource.collection.id) &&
			typeof resource.collection.name === "string"
		);
	if (kind === "object")
		return (
			Number.isSafeInteger(resource.hubuum_class_id) &&
			Number.isSafeInteger(resource.collection_id)
		);
	return true;
}
export function parseStructuredSearchResponse(
	data: unknown,
	kind: StructuredSearchRequest["target"]["kind"],
): StructuredSearchResponse {
	if (
		!record(data) ||
		data.version !== 1 ||
		data.kind !== kind ||
		!Array.isArray(data.results) ||
		(data.next != null && typeof data.next !== "string") ||
		(data.total != null &&
			(!Number.isSafeInteger(data.total) || Number(data.total) < 0)) ||
		data.results.some((item) => !validResult(item, kind))
	)
		throw new Error(
			"The server returned an invalid structured search response.",
		);
	return data as unknown as StructuredSearchResponse;
}
