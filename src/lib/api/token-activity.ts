import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamPrincipalsByPrincipalIdTokensByTokenIdActivity } from "@/lib/api/generated/client";
import type { CredentialActivityResponse } from "@/lib/api/generated/models";

export async function fetchTokenActivity(
	principalId: number,
	tokenId: number,
	offset: number,
	signal?: AbortSignal,
): Promise<CredentialActivityResponse> {
	const response =
		await getApiV1IamPrincipalsByPrincipalIdTokensByTokenIdActivity(
			principalId,
			tokenId,
			{ offset, limit: 50 },
			{ credentials: "include", cache: "no-store", signal },
		);
	if (response.status !== 200) {
		throw new Error(
			response.status === 404
				? "Credential activity is unavailable. The token may have been removed or access is no longer allowed."
				: getApiErrorMessage(
						response.data,
						"Failed to load credential activity.",
					),
		);
	}
	return response.data;
}
