import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamMeTokens,
	getApiV1IamPrincipalsByPrincipalIdTokens,
} from "@/lib/api/generated/client";
import type { TokenListState } from "@/lib/api/generated/models";

export async function fetchTokenPage(
	principalId: number | "me",
	state: TokenListState,
	sort: string,
	cursor: string | undefined,
	signal?: AbortSignal,
) {
	const params = { state, sort, cursor, limit: 25, include_total: true };
	const options = {
		credentials: "include",
		cache: "no-store",
		signal,
	} as const;
	const response =
		principalId === "me"
			? await getApiV1IamMeTokens(params, options)
			: await getApiV1IamPrincipalsByPrincipalIdTokens(
					principalId,
					params,
					options,
				);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load tokens."),
		);
	}
	const count = response.headers.get("X-Total-Count");
	const parsed = count === null ? Number.NaN : Number(count);
	return {
		tokens: response.data,
		nextCursor: response.headers.get("X-Next-Cursor"),
		total: Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null,
	};
}
