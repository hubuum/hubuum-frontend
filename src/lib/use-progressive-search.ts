"use client";
import { useState } from "react";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
/** Keep incomplete stream results out of the completed-query cache. */
export function useProgressiveSearch<T>({
	queryKey,
	enabled,
	streaming,
	fetcher,
}: {
	queryKey: QueryKey;
	enabled: boolean;
	streaming: boolean;
	fetcher: (signal: AbortSignal, onProgress?: (data: T) => void) => Promise<T>;
}) {
	const client = useQueryClient();
	const key = JSON.stringify(queryKey);
	const [progress, setProgress] = useState<{
		key: string;
		data?: T;
		cancelled?: boolean;
	}>({ key: "" });
	const query = useQuery({
		queryKey,
		enabled,
		retry: false,
		retryOnMount: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		refetchOnMount: false,
		queryFn: async ({ signal }) => {
			if (streaming) setProgress({ key });
			return fetcher(
				signal,
				streaming
					? (data) => {
							if (!signal.aborted) setProgress({ key, data });
						}
					: undefined,
			);
		},
	});
	const active = progress.key === key ? progress : undefined;
	const incomplete =
		streaming && (query.isFetching || query.isError || !!active?.cancelled);
	return {
		...query,
		data: incomplete ? active?.data : query.data,
		incomplete,
		cancelled: !!active?.cancelled,
		cancel: () => {
			setProgress((current) =>
				current.key === key
					? { ...current, cancelled: true }
					: { key, cancelled: true },
			);
			void client.cancelQueries({ queryKey, exact: true });
		},
	};
}
