"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
	type KeyboardEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { streamUnifiedSearch } from "@/lib/api/search-stream";
import {
	mergeQuickSearchResults,
	quickSearchParams,
	type QuickSearchDestination,
	type QuickSearchResults,
	uniqueQuickSearchDestination,
} from "@/lib/quick-search";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useProgressiveSearch } from "@/lib/use-progressive-search";

export type QuickSearchOption =
	| QuickSearchDestination
	| {
			id: string;
			label: string;
			onSelect: () => void;
	  };

export function QuickSearch({
	value,
	onChange,
	searchHref,
	label,
	placeholder,
	inputId,
	inputClassName,
	shortcut,
	dropdown = false,
	localOptions = [],
	onNavigate,
	children,
}: {
	value: string;
	onChange: (value: string) => void;
	searchHref: string;
	label: string;
	placeholder: string;
	inputId?: string;
	inputClassName?: string;
	shortcut?: string;
	dropdown?: boolean;
	localOptions?: QuickSearchOption[];
	onNavigate?: () => void;
	children?: ReactNode;
}) {
	const router = useRouter();
	const id = useId();
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLElement>(null);
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState<string | null>(null);
	const [composing, setComposing] = useState(false);
	const term = value.trim();
	const debounced = useDebouncedValue(term, 300);
	const params = quickSearchParams(searchHref);
	const scope = JSON.stringify(params);
	const ready = open && !composing && !!term && params.kinds?.length !== 0;
	const search = useProgressiveSearch<QuickSearchResults>({
		// Changing focus or text detaches the old observer and aborts its request,
		// including during the debounce interval for the next query.
		queryKey: ["quick-search", ready ? scope : null],
		enabled: ready && debounced === term,
		streaming: true,
		fetcher: async (signal, onProgress) => {
			let items: QuickSearchDestination[] = [];
			const response = await streamUnifiedSearch(
				params,
				(batch) => {
					const result = mergeQuickSearchResults(items, batch);
					items = result.items;
					onProgress?.(result);
				},
				signal,
			);
			return mergeQuickSearchResults(items, response);
		},
	});
	const complete = ready && search.isSuccess && !search.incomplete;
	const localHrefs = new Set(
		localOptions.flatMap((item) => ("href" in item ? [item.href] : [])),
	);
	const resources = ready
		? (search.data?.items ?? []).filter((item) => !localHrefs.has(item.href))
		: [];
	const waiting = ready && !complete && !search.isError;
	const showOptions = open && (!!term || localOptions.length > 0);
	const count = search.data?.items.length ?? 0;

	function dismiss() {
		setOpen(false);
		setPending(null);
	}
	function navigate(href: string) {
		dismiss();
		onNavigate?.();
		router.push(href);
	}

	useEffect(() => {
		if (pending !== scope || !open) return;
		if (search.isError) {
			setPending(null);
		} else if (complete) {
			navigate(
				uniqueQuickSearchDestination(search.data, complete) ?? searchHref,
			);
		}
	});

	function onKeyDown(event: KeyboardEvent<HTMLElement>) {
		if (event.nativeEvent.isComposing || composing) return;
		if (event.key === "Escape") {
			if (dropdown) {
				event.preventDefault();
				event.stopPropagation();
				inputRef.current?.focus();
			}
			dismiss();
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
			return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			setPending(null);
			setOpen(true);
			const options = Array.from(
				listRef.current?.querySelectorAll<HTMLElement>(
					"[data-search-option]",
				) ?? [],
			);
			const index = options.indexOf(document.activeElement as HTMLElement);
			const next =
				index === -1
					? event.key === "ArrowDown"
						? 0
						: options.length - 1
					: (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
						options.length;
			options[next]?.focus();
			return;
		}
		if (event.key !== "Enter" || event.target !== inputRef.current) return;
		event.preventDefault();
		if (!term) return;
		const first = localOptions[0];
		if (first) {
			if ("href" in first) navigate(first.href);
			else {
				dismiss();
				first.onSelect();
			}
		} else if (complete) {
			navigate(
				resources.length > 1
					? resources[0].href
					: (uniqueQuickSearchDestination(search.data, complete) ?? searchHref),
			);
		} else if (!ready) {
			navigate(searchHref);
		} else if (!search.isError) {
			setPending(scope);
		}
	}

	const status = !term
		? ""
		: !params.kinds?.length
			? "Choose a catalog on the search page."
			: search.isError
				? "Search interrupted. Results may be incomplete. Retry or show all results."
				: waiting
					? pending
						? "Waiting for search to finish…"
						: "Searching resources…"
					: search.data?.hasMore
						? "More matches available. Refine your search or show all results."
						: `${count} resource ${count === 1 ? "match" : "matches"}. Use arrow keys to choose, then Enter to open.`;

	return (
		<fieldset
			aria-label="Quick search"
			className={
				dropdown ? "quick-search topbar-search-field" : "quick-search stack"
			}
			onFocus={() => setOpen(true)}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) dismiss();
			}}
		>
			<input
				ref={inputRef}
				onKeyDown={onKeyDown}
				id={inputId}
				aria-label={label}
				aria-keyshortcuts={shortcut}
				aria-controls={showOptions ? `${id}-options` : undefined}
				aria-describedby={open && term ? `${id}-status` : undefined}
				className={inputClassName}
				value={value}
				onChange={(event) => {
					setPending(null);
					setOpen(true);
					onChange(event.target.value);
				}}
				onCompositionStart={() => {
					setPending(null);
					setComposing(true);
				}}
				onCompositionEnd={() => setComposing(false)}
				placeholder={placeholder}
				autoComplete="off"
				enterKeyHint="go"
			/>
			{children}
			{showOptions ? (
				<nav
					id={`${id}-options`}
					ref={listRef}
					className={`command-options quick-search-options${dropdown ? " quick-search-popover" : ""}`}
					aria-label="Search suggestions"
					onFocus={() => setPending(null)}
				>
					{[...localOptions, ...resources].map((item) =>
						"href" in item ? (
							<Link
								key={item.href}
								href={item.href}
								prefetch={false}
								data-search-option
								onKeyDown={onKeyDown}
								onClick={() => {
									dismiss();
									onNavigate?.();
								}}
							>
								<span>{item.label}</span>
								{item.detail ? (
									<small className="muted">{item.detail}</small>
								) : null}
							</Link>
						) : (
							<button
								key={item.id}
								type="button"
								data-search-option
								onKeyDown={onKeyDown}
								onClick={() => {
									dismiss();
									item.onSelect();
								}}
							>
								{item.label}
							</button>
						),
					)}
					{term ? (
						<>
							<p
								id={`${id}-status`}
								className="muted quick-search-status"
								role="status"
							>
								{status}
							</p>
							{search.isError ? (
								<button
									type="button"
									data-search-option
									onKeyDown={onKeyDown}
									onClick={() => {
										setPending(null);
										void search.refetch();
									}}
								>
									Retry search
								</button>
							) : null}
							<Link
								href={searchHref}
								prefetch={false}
								data-search-option
								onKeyDown={onKeyDown}
								onClick={() => {
									dismiss();
									onNavigate?.();
								}}
							>
								Show all results for “{term}”
							</Link>
						</>
					) : null}
				</nav>
			) : null}
		</fieldset>
	);
}
