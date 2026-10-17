import { getApiErrorMessage } from "@/lib/api/errors";
import { postApiV1SearchHydrate } from "@/lib/api/generated/client";
import type { SearchHydrationRequest } from "@/lib/api/generated/models";
import { parseSearchHydration } from "@/lib/search-hydration";

export async function fetchSearchHydration(
	request: SearchHydrationRequest,
	signal?: AbortSignal,
) {
	const response = await postApiV1SearchHydrate(request, {
		credentials: "include",
		signal,
	});
	if (response.status === 404 || Number(response.status) === 405)
		throw new Error(
			"Related-resource inspection is unavailable on this server, or the selected resource is no longer accessible. The root search remains usable.",
		);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not inspect related resources. Try a smaller depth or path limit, or retry.",
			),
		);
	return parseSearchHydration(response.data, request);
}
