"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamUsers } from "@/lib/api/generated/client";

async function resolveCurrentUserId(username: string): Promise<number | null> {
	let cursor: string | undefined;

	// Safety cap: avoid an unbounded loop if the cursor never terminates.
	for (let page = 0; page < 50; page += 1) {
		const response = await getApiV1IamUsers(
			{ limit: 250, cursor },
			{ credentials: "include" },
		);

		if (response.status !== 200) {
			return null;
		}

		const match = response.data.find((user) => user.username === username);
		if (match) {
			return match.id;
		}

		const nextCursor = response.headers.get("x-next-cursor");
		if (!nextCursor) {
			return null;
		}
		cursor = nextCursor;
	}

	return null;
}

export function useCurrentUserId(currentUsername: string | null): number | null {
	const query = useQuery({
		queryKey: ["current-user-id", currentUsername],
		queryFn: async () => resolveCurrentUserId(currentUsername as string),
		enabled: Boolean(currentUsername),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	return query.data ?? null;
}
