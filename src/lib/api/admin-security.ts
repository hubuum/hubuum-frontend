import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV0MetaLoginRateLimit,
	deleteApiV0MetaLoginRateLimitById,
	getApiV0MetaLoginRateLimit,
	getApiV1IamUsersByUserId,
	postApiV1IamUsersByUserIdAnonymize,
	postApiV1AuthLogoutUidByUserId,
	getApiV1IamPrincipalsByPrincipalIdSettings,
	putApiV1IamPrincipalsByPrincipalIdSettings,
	patchApiV1IamPrincipalsByPrincipalIdSettings,
	deleteApiV1IamPrincipalsByPrincipalIdSettings,
	getApiV1CollectionsByCollectionIdPermissionsEffectiveGroupByGroupId,
	getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId,
} from "@/lib/api/generated/client";
import type { GetApiV0MetaLoginRateLimitParams } from "@/lib/api/generated/models";
import {
	parseSettingsEdit,
	type SettingsEditMode,
} from "@/lib/principal-settings-edit";
const credentials = { credentials: "include" } as const;
export async function fetchLoginLimits(
	params: GetApiV0MetaLoginRateLimitParams,
) {
	const response = await getApiV0MetaLoginRateLimit(params, credentials);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Failed to inspect login limits."),
		);
	return response.data;
}
export async function clearLoginLimits(id?: string) {
	const response =
		id === undefined
			? await deleteApiV0MetaLoginRateLimit(credentials)
			: await deleteApiV0MetaLoginRateLimitById(
					encodeURIComponent(id),
					credentials,
				);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Failed to release login limits."),
		);
	return response.data;
}
export async function fetchUserRevision(id: number) {
	const response = await getApiV1IamUsersByUserId(id, credentials);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load user revision."),
		);
	return { user: response.data, etag: response.headers.get("ETag") };
}
export async function anonymizeUser(id: number, etag: string) {
	const response = await postApiV1IamUsersByUserIdAnonymize(id, {
		...credentials,
		headers: { "If-Match": etag },
	});
	if (response.status !== 204)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to anonymize user. Reload before trying again.",
			),
		);
}
export async function revokeUserTokens(id: number) {
	const response = await postApiV1AuthLogoutUidByUserId(id, credentials);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Failed to revoke user tokens."),
		);
}
export async function fetchPrincipalSettings(id: number) {
	const response = await getApiV1IamPrincipalsByPrincipalIdSettings(
		id,
		credentials,
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load principal settings."),
		);
	return { ...response.data, etag: response.headers.get("ETag") };
}
export async function savePrincipalSettings(
	id: number,
	etag: string,
	mode: SettingsEditMode | "reset",
	text: string,
) {
	const options = { ...credentials, headers: { "If-Match": etag } };
	const response =
		mode === "reset"
			? await deleteApiV1IamPrincipalsByPrincipalIdSettings(id, options)
			: mode === "replace"
				? await putApiV1IamPrincipalsByPrincipalIdSettings(
						id,
						parseSettingsEdit(text, "replace"),
						options,
					)
				: await patchApiV1IamPrincipalsByPrincipalIdSettings(
						id,
						parseSettingsEdit(text, mode),
						{
							...options,
							headers: {
								...options.headers,
								"Content-Type":
									mode === "merge"
										? "application/merge-patch+json"
										: "application/json-patch+json",
							},
						},
					);
	if (response.status === 204) return fetchPrincipalSettings(id);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to save settings. Reload to resolve a revision conflict.",
			),
		);
	return { ...response.data, etag: response.headers.get("ETag") };
}
export async function fetchEffectiveAccess(
	collectionId: number,
	kind: "principal" | "group",
	id: number,
) {
	const response =
		kind === "group"
			? await getApiV1CollectionsByCollectionIdPermissionsEffectiveGroupByGroupId(
					collectionId,
					id,
					credentials,
				)
			: await getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId(
					collectionId,
					id,
					credentials,
				);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to inspect effective permissions.",
			),
		);
	return response.data;
}
