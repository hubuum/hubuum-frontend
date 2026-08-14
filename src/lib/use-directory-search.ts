"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ResourceDirectory } from "@/lib/api/resource-directory";
import { useDebouncedValue } from "@/lib/use-debounced-value";

type UseDirectorySearchOptions<T> = {
	enabled?: boolean;
	queryFn: (query: string) => Promise<ResourceDirectory<T>>;
	queryKey: readonly unknown[];
};

export function useDirectorySearch<T>({
	enabled = true,
	queryFn,
	queryKey,
}: UseDirectorySearchOptions<T>) {
	const [search, setSearch] = useState("");
	const term = search.trim();
	const minimumLength = /^\d+$/.test(term) ? 1 : 2;
	const debouncedTerm = useDebouncedValue(term, 300);
	const isReady =
		term.length >= minimumLength && debouncedTerm === term && enabled;
	const query = useQuery({
		queryKey: [...queryKey, debouncedTerm],
		queryFn: () => queryFn(debouncedTerm),
		enabled: isReady,
		retry: false,
		staleTime: 5 * 60 * 1000,
	});

	return {
		isReady,
		minimumLength,
		query,
		search,
		setSearch,
		term,
	};
}

type DirectoryLookupStatusOptions = {
	count: number;
	isError: boolean;
	isLoading: boolean;
	isPartial: boolean;
	isReady: boolean;
	minimumLength: number;
	resourcePlural: string;
	resourceSingular: string;
	scope?: string;
	term: string;
};

export function directoryLookupStatus({
	count,
	isError,
	isLoading,
	isPartial,
	isReady,
	minimumLength,
	resourcePlural,
	resourceSingular,
	scope = "visible to your account",
	term,
}: DirectoryLookupStatusOptions): string {
	if (term.length < minimumLength) {
		return `Type at least two characters, or enter an exact ${resourceSingular} ID.`;
	}
	if (isLoading || !isReady) {
		return `Searching ${resourcePlural} ${scope}…`;
	}
	if (isError) {
		return `${resourceSingular[0].toUpperCase()}${resourceSingular.slice(1)} lookup is unavailable; enter an exact ID.`;
	}
	if (isPartial) {
		return `More than 50 ${resourcePlural} match; type more to narrow the results.`;
	}
	if (count === 0) {
		return `No matching ${resourcePlural} are ${scope}.`;
	}
	return `Choose a ${resourceSingular} to fill its ID.`;
}
