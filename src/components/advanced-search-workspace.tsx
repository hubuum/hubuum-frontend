"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { SearchNodeEditor } from "@/components/advanced-search-builder";
import { ResourcePicker } from "@/components/resource-picker";
import { TablePagination } from "@/components/table-pagination";
import {
	advancedSearchUrl,
	buildAdvancedSearch,
	emptySearchDraft,
	restoreAdvancedSearch,
	sortsFor,
	type SearchDraft,
	type SearchTarget,
} from "@/lib/advanced-search";
import { fetchAdvancedSearch } from "@/lib/api/advanced-search";
import type {
	StructuredSearchRequest,
	StructuredSearchResult,
} from "@/lib/api/generated/models";
import { SearchResourceContext } from "@/components/search-resource-context";
import { SearchRelatedResources } from "@/components/search-related-resources";

function SearchResultRow({
	result,
	hydration,
	pageKey,
}: {
	result: StructuredSearchResult;
	hydration: SearchDraft["hydration"];
	pageKey: string;
}) {
	const [inspection, setInspection] = useState<"unopened" | "open" | "closed">(
		"unopened",
	);
	const inspecting = inspection === "open";
	const inspectionId = useId();
	if (
		result.kind !== "object" &&
		result.kind !== "class" &&
		result.kind !== "collection"
	)
		return null;
	const resource = result.resource;
	const href =
		result.kind === "object"
			? `/objects/${result.resource.hubuum_class_id}/${resource.id}`
			: `/${result.kind === "class" ? "classes" : "collections"}/${resource.id}`;
	return (
		<>
			<tr>
				<td>
					<Link href={href}>
						{resource.name} (#{resource.id})
					</Link>
				</td>
				<td>
					{result.kind === "object" ? (
						<div className="stack">
							<SearchResourceContext
								kind="class"
								id={result.resource.hubuum_class_id}
							/>
							<SearchResourceContext
								kind="collection"
								id={result.resource.collection_id}
							/>
						</div>
					) : result.kind === "class" ? (
						<Link href={`/collections/${result.resource.collection.id}`}>
							{result.resource.collection.name} (#
							{result.resource.collection.id})
						</Link>
					) : (
						"Collection"
					)}
				</td>
				<td>{resource.description || "—"}</td>
				<td>{resource.updated_at}</td>
				{hydration && (
					<td>
						<button
							type="button"
							className="ghost"
							aria-expanded={inspecting}
							aria-controls={inspectionId}
							onClick={() => setInspection(inspecting ? "closed" : "open")}
						>
							{inspecting
								? "Close related resources"
								: "Inspect related resources"}
						</button>
					</td>
				)}
			</tr>
			{hydration && result.kind === "object" && (
				<tr hidden={!inspecting}>
					<td colSpan={5} id={inspectionId}>
						{inspection !== "unopened" && (
							<SearchRelatedResources
								root={result.resource}
								settings={hydration}
								pageKey={pageKey}
							/>
						)}
					</td>
				</tr>
			)}
		</>
	);
}

function initialState(raw: string | undefined): {
	draft: SearchDraft;
	error?: string;
} {
	if (!raw) return { draft: emptySearchDraft() };
	try {
		return { draft: restoreAdvancedSearch(raw) };
	} catch (error) {
		return {
			draft: emptySearchDraft(),
			error: `Cannot restore this query: ${error instanceof Error ? error.message : "Invalid saved state"}`,
		};
	}
}

export function AdvancedSearchWorkspace({
	savedQuery,
}: {
	savedQuery?: string;
}) {
	const id = useId();
	const [ready, setReady] = useState(false);
	useEffect(() => setReady(true), []);
	const [initial] = useState(() => initialState(savedQuery));
	const [draft, setDraft] = useState(initial.draft);
	const [executed, setExecuted] = useState<{
		draft: SearchDraft;
		request: StructuredSearchRequest;
		sequence: number;
	} | null>(null);
	const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
	const cursor = cursors[cursors.length - 1];
	let request: StructuredSearchRequest | undefined;
	let validation: string | undefined;
	try {
		request = buildAdvancedSearch(draft);
	} catch (error) {
		validation = error instanceof Error ? error.message : "Invalid query";
	}
	const search = useQuery({
		queryKey: ["advanced-search", executed, cursor],
		queryFn: ({ signal }) => {
			if (!executed) throw new Error("Run a search first.");
			return fetchAdvancedSearch({ ...executed.request, cursor }, signal);
		},
		enabled: executed !== null,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const edited =
		executed && JSON.stringify(executed.draft) !== JSON.stringify(draft);
	return (
		<section className="stack advanced-search">
			<header className="stack">
				<h1>Advanced search</h1>
				<p>
					Choose one resource type and build a query. Match all uses AND; match
					any uses OR. NOT negates the complete condition or group.
				</p>
				<Link href="/search">Ordinary search</Link>
			</header>
			{initial.error ? (
				<div className="error-banner" role="alert">
					<p>{initial.error}</p>
					<p>
						The saved query has not been run or replaced. Open a new builder to
						start again.
					</p>
					<details>
						<summary>Original saved query</summary>
						<pre>{savedQuery}</pre>
					</details>
					<Link href="/search/advanced">Start a new search</Link>
				</div>
			) : (
				<form
					className="stack card"
					onSubmit={(event) => {
						event.preventDefault();
						if (!request) return;
						setCursors([undefined]);
						setExecuted({
							draft: structuredClone(draft),
							request,
							sequence: (executed?.sequence ?? 0) + 1,
						});
						window.history.replaceState(null, "", advancedSearchUrl(draft));
					}}
				>
					<fieldset className="stack advanced-form" disabled={!ready}>
						<legend className="sr-only">Query builder</legend>
						<div className="advanced-controls">
							<label htmlFor={`${id}-target`}>
								Search
								<select
									id={`${id}-target`}
									value={draft.target}
									onChange={(event) =>
										setDraft({
											...draft,
											target: event.target.value as SearchTarget,
										})
									}
								>
									<option value="collection">Collections</option>
									<option value="class">Classes</option>
									<option value="object">Objects</option>
								</select>
							</label>
							{(draft.target === "object" || draft.classId) && (
								<div className="stack">
									<ResourcePicker
										kind="class"
										label="Exact object class (optional)"
										emptyLabel="All accessible object classes"
										value={draft.classId}
										onChange={(classId) => setDraft({ ...draft, classId })}
										showIdentity
									/>
									{draft.classId && (
										<button
											type="button"
											className="ghost"
											onClick={() => setDraft({ ...draft, classId: "" })}
										>
											Clear exact class
										</button>
									)}
								</div>
							)}
						</div>
						<SearchNodeEditor
							node={draft.filter}
							target={draft.target}
							onChange={(filter) => setDraft({ ...draft, filter })}
						/>
						<fieldset className="stack advanced-group">
							<legend>Result order</legend>
							{draft.sort.map((sort, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: Each controlled slot represents a sort priority.
								<div className="advanced-controls" key={`${id}-sort-${index}`}>
									<label htmlFor={`${id}-sort-${index}`}>
										Sort field {index + 1}
										<select
											id={`${id}-sort-${index}`}
											value={sort.field}
											onChange={(event) =>
												setDraft({
													...draft,
													sort: draft.sort.map((item, i) =>
														i === index
															? { ...item, field: event.target.value }
															: item,
													),
												})
											}
										>
											{!sortsFor(draft.target).some(
												(item) => item.field === sort.field,
											) && (
												<option value={sort.field}>
													{sort.field} (incompatible)
												</option>
											)}
											{sortsFor(draft.target).map((item) => (
												<option key={item.field} value={item.field}>
													{item.label}
												</option>
											))}
										</select>
									</label>
									<label htmlFor={`${id}-direction-${index}`}>
										Direction {index + 1}
										<select
											id={`${id}-direction-${index}`}
											value={sort.direction}
											onChange={(event) =>
												setDraft({
													...draft,
													sort: draft.sort.map((item, i) =>
														i === index
															? {
																	...item,
																	direction: event.target.value as
																		| "asc"
																		| "desc",
																}
															: item,
													),
												})
											}
										>
											<option value="asc">Ascending</option>
											<option value="desc">Descending</option>
										</select>
									</label>
									{draft.sort.length > 1 && (
										<button
											type="button"
											className="ghost"
											onClick={() =>
												setDraft({
													...draft,
													sort: draft.sort.filter((_, i) => i !== index),
												})
											}
										>
											Remove sort {index + 1}
										</button>
									)}
								</div>
							))}
							<button
								type="button"
								className="ghost"
								disabled={draft.sort.length >= sortsFor(draft.target).length}
								onClick={() => {
									const field = sortsFor(draft.target).find(
										(field) =>
											!draft.sort.some((sort) => sort.field === field.field),
									);
									if (field)
										setDraft({
											...draft,
											sort: [
												...draft.sort,
												{ field: field.field, direction: "asc" },
											],
										});
								}}
							>
								Add sort field
							</button>
							<label htmlFor={`${id}-limit`}>
								Results per page
								<select
									id={`${id}-limit`}
									value={draft.limit}
									onChange={(event) =>
										setDraft({ ...draft, limit: Number(event.target.value) })
									}
								>
									{[...new Set([25, 50, 100, draft.limit])]
										.sort((a, b) => a - b)
										.map((limit) => (
											<option key={limit} value={limit}>
												{limit}
											</option>
										))}
								</select>
							</label>
						</fieldset>
						<fieldset className="stack advanced-group">
							<legend>Related-resource inspection</legend>
							<label className="checkbox-label">
								<input
									type="checkbox"
									checked={draft.hydration !== null}
									onChange={(event) =>
										setDraft({
											...draft,
											hydration: event.target.checked
												? { classId: "", depth: 1, limit: 25 }
												: null,
										})
									}
								/>
								Enable optional related-resource inspection
							</label>
							{draft.hydration && (
								<>
									<p>
										Inspect all visible related objects in the selected class
										and depth. These neighbors provide context; they are not
										evidence that a particular related-object condition matched.
										Resources load only when you inspect a result.
									</p>
									<ResourcePicker
										kind="class"
										label="Related-resource class"
										value={draft.hydration.classId}
										onChange={(classId) => {
											if (draft.hydration)
												setDraft({
													...draft,
													hydration: { ...draft.hydration, classId },
												});
										}}
										showIdentity
									/>
									<div className="advanced-controls">
										<label htmlFor={`${id}-hydrate-depth`}>
											Inspection depth (1–10)
											<input
												id={`${id}-hydrate-depth`}
												type="number"
												min="1"
												max="10"
												value={draft.hydration.depth}
												onChange={(event) => {
													if (draft.hydration)
														setDraft({
															...draft,
															hydration: {
																...draft.hydration,
																depth: Number(event.target.value),
															},
														});
												}}
											/>
										</label>
										<label htmlFor={`${id}-hydrate-limit`}>
											Maximum paths per result
											<select
												id={`${id}-hydrate-limit`}
												value={draft.hydration.limit}
												onChange={(event) => {
													if (draft.hydration)
														setDraft({
															...draft,
															hydration: {
																...draft.hydration,
																limit: Number(event.target.value),
															},
														});
												}}
											>
												{[...new Set([10, 25, 50, draft.hydration.limit])]
													.sort((a, b) => a - b)
													.map((limit) => (
														<option key={limit} value={limit}>
															{limit}
														</option>
													))}
											</select>
										</label>
									</div>
								</>
							)}
						</fieldset>
						{validation && (
							<p className="error-banner" role="status">
								{validation}
							</p>
						)}
						{request && (
							<details>
								<summary>Query to run (exact API expression)</summary>
								<pre>{JSON.stringify(request, null, 2)}</pre>
							</details>
						)}
						<div className="advanced-controls">
							<button type="submit" disabled={!request}>
								Run search
							</button>
							{request && (
								<Link href={advancedSearchUrl(draft)} prefetch={false}>
									Bookmark this query
								</Link>
							)}
						</div>
					</fieldset>
				</form>
			)}
			{executed && (
				<section
					className="stack card"
					aria-label="Search results"
					aria-busy={search.isFetching}
				>
					<h2>Results</h2>
					<p role="status">
						{edited
							? "The builder has changed. These results belong to the last executed query; run search to apply your edits."
							: "Results for the last executed query."}
					</p>
					<details>
						<summary>Executed query</summary>
						<pre>{JSON.stringify(executed.request, null, 2)}</pre>
					</details>
					{search.isFetching && <p role="status">Searching…</p>}
					{search.error && (
						<div className="error-banner" role="alert">
							{search.error.message}
							<button
								type="button"
								className="ghost"
								onClick={() => void search.refetch()}
							>
								Retry search
							</button>
						</div>
					)}
					{search.data && !search.isError && (
						<>
							<p>
								{search.data.total != null
									? `${search.data.total} matching resources`
									: `${search.data.results.length} resources on this page`}
							</p>
							{search.data.results.length ? (
								<div className="table-wrap">
									<table>
										<caption className="sr-only">
											Advanced search results
										</caption>
										<thead>
											<tr>
												<th scope="col">Name and ID</th>
												<th scope="col">Context</th>
												<th scope="col">Description</th>
												<th scope="col">Updated</th>
												{executed.draft.hydration && (
													<th scope="col">Related resources</th>
												)}
											</tr>
										</thead>
										<tbody>
											{search.data.results.map((result) => (
												<SearchResultRow
													key={`${executed.sequence}-${cursor ?? "first"}-${result.kind}-${result.resource.id}`}
													hydration={executed.draft.hydration}
													pageKey={JSON.stringify([executed, cursor])}
													result={result}
												/>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p>No resources match this query.</p>
							)}
						</>
					)}
					<TablePagination
						hasNextPage={!!search.data?.next && !search.isError}
						hasPrevPage={cursors.length > 1}
						onNextPage={() => {
							if (search.data?.next) setCursors([...cursors, search.data.next]);
						}}
						onPrevPage={() => setCursors(cursors.slice(0, -1))}
						onFirstPage={() => setCursors([undefined])}
						currentCount={search.data?.results.length ?? 0}
						totalCount={search.data?.total}
						busy={search.isFetching}
					/>
				</section>
			)}
		</section>
	);
}
