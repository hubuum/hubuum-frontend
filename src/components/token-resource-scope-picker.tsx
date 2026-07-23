"use client";

import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";

import { getApiV1ClassesByClassId } from "@/lib/api/generated/client";
import type {
	HubuumObject,
	TokenResourceScope,
} from "@/lib/api/generated/models";
import { fetchUnifiedSearch } from "@/lib/api/search";
import {
	MAX_TOKEN_RESOURCE_SCOPES,
	type NamedTokenResourceScope,
	tokenResourceScopeKey,
} from "@/lib/token-resource-scope-selection";

type TokenResourceScopePickerProps = {
	disabled?: boolean;
	onChange: (selected: NamedTokenResourceScope[]) => void;
	selected: NamedTokenResourceScope[];
};

type ClassContext = {
	className: string;
	collectionName: string;
};

async function fetchClassContextByIds(
	classIds: number[],
): Promise<Record<number, ClassContext>> {
	const settled = await Promise.allSettled(
		classIds.map(async (classId) => {
			const response = await getApiV1ClassesByClassId(classId, {
				credentials: "include",
			});

			if (response.status !== 200) {
				return null;
			}

			return {
				classId,
				context: {
					className: response.data.name,
					collectionName: response.data.collection.name,
				},
			};
		}),
	);

	const contextById: Record<number, ClassContext> = {};
	for (const result of settled) {
		if (result.status !== "fulfilled" || !result.value) {
			continue;
		}
		contextById[result.value.classId] = result.value.context;
	}
	return contextById;
}

function objectLabel(object: HubuumObject, context?: ClassContext): string {
	const className = context?.className ?? `Class #${object.hubuum_class_id}`;
	const collectionName =
		context?.collectionName ?? `Collection #${object.collection_id}`;
	return `${object.name} (#${object.id}) · ${className} · ${collectionName}`;
}

export function TokenResourceScopePicker({
	disabled,
	onChange,
	selected,
}: TokenResourceScopePickerProps) {
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search.trim());

	const searchQuery = useQuery({
		queryKey: ["token-resource-search", deferredSearch],
		queryFn: () =>
			fetchUnifiedSearch({
				q: deferredSearch,
				kinds: ["collection", "class", "object"],
				limitPerKind: 25,
			}),
		enabled: deferredSearch.length > 0,
	});

	const results = searchQuery.data?.results;
	const inlineClassContext = useMemo(() => {
		const context: Record<number, ClassContext> = {};
		for (const item of results?.classes ?? []) {
			context[item.id] = {
				className: item.name,
				collectionName: item.collection.name,
			};
		}
		return context;
	}, [results?.classes]);
	const unresolvedObjectClassIds = useMemo(() => {
		const ids = new Set<number>();
		for (const object of results?.objects ?? []) {
			if (!inlineClassContext[object.hubuum_class_id]) {
				ids.add(object.hubuum_class_id);
			}
		}
		return [...ids].sort((left, right) => left - right);
	}, [inlineClassContext, results?.objects]);
	const classContextQuery = useQuery({
		queryKey: ["token-resource-search-class-context", unresolvedObjectClassIds],
		queryFn: () => fetchClassContextByIds(unresolvedObjectClassIds),
		enabled: unresolvedObjectClassIds.length > 0,
	});
	const classContextById = useMemo(
		() => ({ ...classContextQuery.data, ...inlineClassContext }),
		[classContextQuery.data, inlineClassContext],
	);
	const selectedKeys = useMemo(
		() => new Set(selected.map(tokenResourceScopeKey)),
		[selected],
	);
	const atLimit = selected.length >= MAX_TOKEN_RESOURCE_SCOPES;

	function toggle(scope: NamedTokenResourceScope, checked: boolean) {
		const key = tokenResourceScopeKey(scope);
		if (checked) {
			if (selectedKeys.has(key) || atLimit) {
				return;
			}
			onChange([...selected, scope]);
			return;
		}
		onChange(selected.filter((item) => tokenResourceScopeKey(item) !== key));
	}

	function renderOption(
		scope: TokenResourceScope,
		label: string,
		description: string,
	) {
		const key = tokenResourceScopeKey(scope);
		const checked = selectedKeys.has(key);
		return (
			<label key={key} className="token-resource-result">
				<input
					type="checkbox"
					checked={checked}
					disabled={disabled || (!checked && atLimit)}
					onChange={(event) =>
						toggle({ ...scope, label }, event.target.checked)
					}
				/>
				<span>
					<strong>{label}</strong>
					<small>{description}</small>
				</span>
			</label>
		);
	}

	const resultCount =
		(results?.collections.length ?? 0) +
		(results?.classes.length ?? 0) +
		(results?.objects.length ?? 0);

	return (
		<div className="stack token-resource-picker">
			<label className="control-field control-field--wide">
				<span>Find resources by name</span>
				<input
					type="search"
					value={search}
					disabled={disabled}
					onChange={(event) => setSearch(event.target.value)}
					placeholder="Search collections, classes, and objects"
				/>
			</label>
			<p className="muted">
				Collection entries include their classes and objects. Class entries
				include their objects. Object entries include only that object.
			</p>

			{selected.length > 0 ? (
				<section className="stack token-resource-selected">
					<div className="panel-header">
						<strong>
							Selected resources{" "}
							<span className="muted">({selected.length})</span>
						</strong>
						<button
							type="button"
							className="ghost"
							disabled={disabled}
							onClick={() => onChange([])}
						>
							Clear all
						</button>
					</div>
					<div className="chip-row">
						{selected.map((scope) => (
							<button
								key={tokenResourceScopeKey(scope)}
								type="button"
								className="badge token-resource-chip"
								disabled={disabled}
								onClick={() => toggle(scope, false)}
								aria-label={`Remove ${scope.kind} ${scope.label}`}
							>
								<span className="token-resource-kind">{scope.kind}</span>
								{scope.label}
								<span aria-hidden="true">×</span>
							</button>
						))}
					</div>
				</section>
			) : null}

			{atLimit ? (
				<div className="warning-banner">
					The backend accepts at most {MAX_TOKEN_RESOURCE_SCOPES} resource
					entries.
				</div>
			) : null}

			{!deferredSearch ? (
				<div className="info-banner">
					Enter a resource name to search across all three resource kinds.
				</div>
			) : searchQuery.isLoading ? (
				<div className="muted">Searching resources...</div>
			) : searchQuery.isError ? (
				<div className="error-banner">
					{searchQuery.error instanceof Error
						? searchQuery.error.message
						: "Failed to search resources."}
				</div>
			) : resultCount === 0 ? (
				<div className="muted">
					No resources match &quot;{deferredSearch}&quot;.
				</div>
			) : (
				<div className="token-resource-results">
					{results?.collections.length ? (
						<fieldset className="token-resource-group">
							<legend>Collections</legend>
							{results.collections.map((collection) =>
								renderOption(
									{ kind: "collection", id: collection.id },
									`${collection.name} (#${collection.id})`,
									collection.description || "Collection and its descendants",
								),
							)}
						</fieldset>
					) : null}
					{results?.classes.length ? (
						<fieldset className="token-resource-group">
							<legend>Classes</legend>
							{results.classes.map((item) =>
								renderOption(
									{ kind: "class", id: item.id },
									`${item.name} (#${item.id})`,
									`${item.collection.name} (#${item.collection.id})`,
								),
							)}
						</fieldset>
					) : null}
					{results?.objects.length ? (
						<fieldset className="token-resource-group">
							<legend>Objects</legend>
							{results.objects.map((object) => {
								const context = classContextById[object.hubuum_class_id];
								return renderOption(
									{ kind: "object", id: object.id },
									objectLabel(object, context),
									object.description || "Object only",
								);
							})}
							{classContextQuery.isFetching ? (
								<small className="muted">
									Resolving class and collection names...
								</small>
							) : null}
						</fieldset>
					) : null}
				</div>
			)}
		</div>
	);
}
