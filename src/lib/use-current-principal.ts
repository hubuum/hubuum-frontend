"use client";

import { useQuery } from "@tanstack/react-query";

import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1IamMe } from "@/lib/api/generated/client";
import type { MeResponse } from "@/lib/api/generated/models";

async function fetchCurrentPrincipal(): Promise<MeResponse> {
	const response = await getApiV1IamMe({ credentials: "include" });
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

export function useCurrentPrincipal() {
	return useQuery({
		queryKey: ["current-principal"],
		queryFn: fetchCurrentPrincipal,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: Number.POSITIVE_INFINITY,
	});
}
