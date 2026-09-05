"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { type RefObject, useId, useMemo, useState } from "react";
import { DirectoryLookupPopover } from "@/components/directory-lookup-popover";
import {
	fetchResourceOption,
	fetchResourceOptions,
	type ResourceOptionKind,
} from "@/lib/api/resource-options";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export function ResourcePicker({
	kind,
	value,
	onChange,
	label,
	disabled = false,
	selectedName,
	buttonRef,
	buttonId,
	emptyLabel,
}: {
	kind: ResourceOptionKind;
	value: string;
	onChange: (id: string) => void;
	label: string;
	disabled?: boolean;
	selectedName?: string;
	emptyLabel?: string;
	buttonId?: string;
	buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const search = useDebouncedValue(query, 200);
	const selected = useQuery({
		queryKey: ["resource-option", kind, value],
		queryFn: ({ signal }) => fetchResourceOption(kind, value, signal),
		enabled: !!value && !selectedName,
	});
	const result = useInfiniteQuery({
		queryKey: ["resource-options", kind, search],
		queryFn: ({ pageParam, signal }) =>
			fetchResourceOptions(kind, search, pageParam, signal),
		initialPageParam: undefined as string | undefined,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: open,
	});
	const options = useMemo(() => {
		const items =
			query !== search
				? []
				: (result.data?.pages.flatMap((page) => page.items) ?? []);
		return [...new Map(items.map((item) => [item.id, item])).values()].map(
			(item) => ({
				id: String(item.id),
				item,
				primary: item.name,
				secondary: `#${item.id} · ${"collection" in item ? `Collection ${item.collection.name} (#${item.collection.id})` : item.parent_collection_id ? `Parent collection #${item.parent_collection_id}` : "Root collection"}${item.description ? ` · ${item.description}` : ""}`,
				title: `${item.name} (#${item.id})`,
			}),
		);
	}, [query, search, result.data]);
	const selectionLabel =
		selectedName ??
		selected.data?.name ??
		(value ? `#${value}` : (emptyLabel ?? `Select ${kind}`));
	return (
		<div className="resource-picker">
			<DirectoryLookupPopover
				buttonId={buttonId}
				buttonRef={buttonRef}
				idPrefix={id}
				label={label}
				triggerAccessibleLabel={`${label}: ${selectionLabel}`}
				inputLabel={`Search ${kind === "class" ? "classes" : "collections"}`}
				placeholder="Search all accessible resources"
				value={query}
				onChange={setQuery}
				triggerLabel={selectionLabel}
				disabled={disabled}
				onOpenChange={setOpen}
				options={options}
				onSelect={(item) => onChange(String(item.id))}
				helperText={
					result.isError ? (
						<>
							<span>Could not load results. </span>
							<button
								type="button"
								className="ghost"
								onClick={() => void result.refetch()}
							>
								Retry
							</button>
						</>
					) : (query !== search || result.isFetching) &&
						!result.isFetchingNextPage ? (
						"Searching…"
					) : (
						`${options.length} results${result.hasNextPage ? "; more available" : ""}. Search by name to narrow the list.`
					)
				}
				onLoadMore={
					result.hasNextPage ? () => void result.fetchNextPage() : undefined
				}
				loadingMore={result.isFetchingNextPage}
			/>
			{selected.isError ? (
				<small className="error-banner" role="alert">
					Selected {kind} is unavailable. Choose another.
				</small>
			) : null}
		</div>
	);
}
