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
	const data = response.data;
	if (
		!data ||
		typeof data !== "object" ||
		data.version !== 1 ||
		data.kind !== request.target.kind ||
		!Array.isArray(data.results) ||
		(data.next != null && typeof data.next !== "string") ||
		(data.total != null &&
			(!Number.isSafeInteger(data.total) || data.total < 0)) ||
		data.results.some(
			(item) =>
				!item ||
				item.kind !== data.kind ||
				!item.resource ||
				!Number.isSafeInteger(item.resource.id) ||
				!("name" in item.resource) ||
				typeof item.resource.name !== "string" ||
				!("description" in item.resource) ||
				typeof item.resource.description !== "string" ||
				!("updated_at" in item.resource) ||
				typeof item.resource.updated_at !== "string" ||
				(item.kind === "class" &&
					(!item.resource.collection ||
						!Number.isSafeInteger(item.resource.collection.id) ||
						typeof item.resource.collection.name !== "string")) ||
				(item.kind === "object" &&
					(!Number.isSafeInteger(item.resource.hubuum_class_id) ||
						!Number.isSafeInteger(item.resource.collection_id))),
		)
	)
		throw new Error(
			"The server returned an invalid structured search response.",
		);
	return data;
}
