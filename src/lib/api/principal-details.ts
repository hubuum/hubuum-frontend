import { findCursorPageItem } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1IamServiceAccounts,
	getApiV1IamUsers,
} from "@/lib/api/generated/client";
import type {
	ServiceAccountResponse,
	UserResponse,
} from "@/lib/api/generated/models";

export async function fetchUserListEntry(
	userId: number,
): Promise<UserResponse> {
	const user = await findCursorPageItem(
		async (cursor) => {
			const response = await getApiV1IamUsers(
				{ cursor, include_total: false, limit: 250, sort: "id.asc" },
				{ credentials: "include" },
			);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(response.data, "Failed to load user."),
				);
			}

			return {
				items: response.data,
				nextCursor: response.headers.get("X-Next-Cursor"),
			};
		},
		(candidate) => candidate.id === userId,
	);

	if (!user) {
		throw new Error("User not found.");
	}
	return user;
}

export async function fetchServiceAccountListEntry(
	serviceAccountId: number,
): Promise<ServiceAccountResponse> {
	const account = await findCursorPageItem(
		async (cursor) => {
			const response = await getApiV1IamServiceAccounts(
				{ cursor, include_total: false, limit: 250, sort: "id.asc" },
				{ credentials: "include" },
			);
			if (response.status !== 200) {
				throw new Error(
					getApiErrorMessage(
						response.data,
						"Failed to load service account.",
					),
				);
			}

			return {
				items: response.data,
				nextCursor: response.headers.get("X-Next-Cursor"),
			};
		},
		(candidate) => candidate.id === serviceAccountId,
	);

	if (!account) {
		throw new Error("Service account not found.");
	}
	return account;
}
