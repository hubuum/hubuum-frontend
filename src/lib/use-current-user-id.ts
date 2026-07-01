"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiV1IamMe } from "@/lib/api/generated/client";

async function resolveCurrentUserId(): Promise<number | null> {
	const response = await getApiV1IamMe({ credentials: "include" });
	if (response.status !== 200) {
		return null;
	}
	return response.data.principal.principal_id;
}

export function useCurrentUserId(
	currentUsername: string | null,
): number | null {
	const query = useQuery({
		queryKey: ["current-user-id", currentUsername],
		queryFn: async () => resolveCurrentUserId(),
		enabled: Boolean(currentUsername),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});

	return query.data ?? null;
}
