"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamMe } from "@/lib/api/generated/client";
import type { MeResponse } from "@/lib/api/generated/models";

async function fetchCurrentPrincipal(signal: AbortSignal): Promise<MeResponse> {
	const response = await getApiV1IamMe({
		credentials: "include",
		cache: "no-store",
		signal,
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to resolve the current principal.",
			),
		);
	}
	return response.data;
}

export function useCurrentPrincipal({ live = false }: { live?: boolean } = {}) {
	return useQuery({
		queryKey: ["current-principal"],
		queryFn: ({ signal }) => fetchCurrentPrincipal(signal),
		staleTime: live ? 0 : Number.POSITIVE_INFINITY,
		refetchInterval: live ? 30_000 : false,
		refetchOnWindowFocus: live,
		gcTime: Number.POSITIVE_INFINITY,
	});
}
