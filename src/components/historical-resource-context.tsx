"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { JsonViewer } from "@/components/json-viewer";
import styles from "@/components/resource-history.module.css";
import type { HistoryResponseHistoryMarker } from "@/lib/api/generated/models";
import {
	fetchHistoricalComputed,
	fetchHistoricalPopulation,
	fetchHistoricalRelations,
} from "@/lib/api/history-navigation";
import type { HistoricalEndpointContext } from "@/lib/api/generated/models";
import { type HistoryScope, resourceHistoryHref } from "@/lib/resource-history";

function Endpoint({
	endpoint,
	kind,
	at,
}: {
	endpoint: HistoricalEndpointContext;
	kind: "class" | "object";
	at: string;
}) {
	if (endpoint.status === "unavailable")
		return (
			<span>
				Historical endpoint unavailable ({endpoint.reason.replaceAll("_", " ")})
			</span>
		);
	const record = endpoint.snapshot;
	const scope: HistoryScope | null =
		kind === "class"
			? { type: "class", classId: record.id }
			: record.hubuum_class_id != null
				? {
						type: "object",
						classId: record.hubuum_class_id,
						objectId: record.id,
					}
				: null;
	return scope ? (
		<Link href={resourceHistoryHref(scope, at, record.history_id)}>
			{record.name} (#{record.id})
		</Link>
	) : (
		<span>
			{record.name} (#{record.id})
		</span>
	);
}

export function HistoricalResourceContext({
	scope,
	record,
	at,
}: {
	scope: HistoryScope;
	record: HistoryResponseHistoryMarker;
	at: string;
}) {
	const [relationsOpen, setRelationsOpen] = useState(false);
	const [populationOpen, setPopulationOpen] = useState(false);
	const [computedOpen, setComputedOpen] = useState(false);
	const relations = useInfiniteQuery({
		queryKey: ["historical-relations", scope, at],
		initialPageParam: "",
		queryFn: ({ pageParam, signal }) =>
			fetchHistoricalRelations(scope, at, pageParam || undefined, signal),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: relationsOpen,
		retry: false,
	});
	const population = useInfiniteQuery({
		queryKey: ["historical-population", scope.classId, at],
		initialPageParam: "",
		queryFn: ({ pageParam, signal }) =>
			fetchHistoricalPopulation(
				scope.classId,
				at,
				pageParam || undefined,
				signal,
			),
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: scope.type === "class" && populationOpen,
		retry: false,
	});
	const computed = useQuery({
		queryKey: ["historical-computed", scope, at, record.history_id],
		queryFn: ({ signal }) => {
			if (scope.type !== "object")
				throw new Error("Choose an object snapshot.");
			return fetchHistoricalComputed(scope, at, record.history_id, signal);
		},
		enabled: scope.type === "object" && computedOpen,
		retry: false,
	});
	const edges = relations.data?.pages.flatMap((page) => page.items) ?? [];
	const objects = population.data?.pages.flatMap((page) => page.items) ?? [];
	const shared = computed.data?.shared;
	return (
		<>
			<details
				className={styles.provenance}
				onToggle={(event) => setRelationsOpen(event.currentTarget.open)}
			>
				<summary>Historical relationships</summary>
				<section className="stack" aria-label="Historical relationships">
					<p>
						Direct relationships at <time dateTime={at}>{at}</time>. Only
						authorized retained history is shown; missing history does not prove
						there were no relationships.
					</p>
					{relations.isFetching ? (
						<p role="status">Loading historical relationships…</p>
					) : null}
					{relations.isError ? (
						<p role="alert">
							{relations.error.message}{" "}
							<button type="button" onClick={() => void relations.refetch()}>
								Retry relationships
							</button>
						</p>
					) : null}
					{!relations.isError && relations.data ? (
						edges.length ? (
							<ul className="stack">
								{edges.map((edge) => (
									<li key={edge.history_id}>
										<Endpoint endpoint={edge.from} kind={edge.kind} at={at} /> →{" "}
										<Endpoint endpoint={edge.to} kind={edge.kind} at={at} />
										{edge.kind === "class" && edge.relation.forward_label ? (
											<> · {edge.relation.forward_label}</>
										) : null}
										<span className="muted">
											{" "}
											· Relation #{edge.relation.id}, version #{edge.history_id}
										</span>
									</li>
								))}
							</ul>
						) : (
							<p>
								No relationships are visible in retained history at this time.
							</p>
						)
					) : null}
					{relations.hasNextPage ? (
						<button
							type="button"
							disabled={relations.isFetching}
							onClick={() => void relations.fetchNextPage()}
						>
							Load older relationship entries
						</button>
					) : null}
				</section>
			</details>
			{scope.type === "class" ? (
				<details
					className={styles.provenance}
					onToggle={(event) => setPopulationOpen(event.currentTarget.open)}
				>
					<summary>Historical object population</summary>
					<section className="stack" aria-label="Historical object population">
						<p>
							Objects belonging to this class at <time dateTime={at}>{at}</time>
							, from retained history. An empty result does not prove that the
							class was empty.
						</p>
						{population.isFetching ? (
							<p role="status">Loading historical objects…</p>
						) : null}
						{population.isError ? (
							<p role="alert">
								{population.error.message}{" "}
								<button type="button" onClick={() => void population.refetch()}>
									Retry historical objects
								</button>
							</p>
						) : null}
						{!population.isError && population.data ? (
							<>
								<p>
									Class at this time:{" "}
									{population.data.pages[0].classSnapshot.name}, version #
									{population.data.pages[0].classSnapshot.history_id}.
								</p>
								{objects.length ? (
									<ul className="stack">
										{objects.map((object) => (
											<li key={object.history_id}>
												<Link
													href={resourceHistoryHref(
														{
															type: "object",
															classId: object.hubuum_class_id,
															objectId: object.id,
														},
														at,
														object.history_id,
													)}
												>
													{object.name} (#{object.id})
												</Link>
												<span className="muted">
													{" "}
													· Revision {object.revision} · Collection #
													{object.collection_id}
												</span>
												<details>
													<summary>Stored object data</summary>
													<JsonViewer value={object.data} defaultTab="json" />
												</details>
											</li>
										))}
									</ul>
								) : (
									<p>
										No objects are visible in retained history at this time.
									</p>
								)}
							</>
						) : null}
						{population.hasNextPage ? (
							<button
								type="button"
								disabled={population.isFetching}
								onClick={() => void population.fetchNextPage()}
							>
								Load more historical objects
							</button>
						) : null}
					</section>
				</details>
			) : (
				<details
					className={styles.provenance}
					onToggle={(event) => setComputedOpen(event.currentTarget.open)}
				>
					<summary>Historical computed values</summary>
					<section className="stack" aria-label="Historical computed values">
						<p>
							Recomputed from the stored object and shared definitions effective
							at <time dateTime={at}>{at}</time>. These are not recorded
							materialized values. Personal historical fields are unsupported.
						</p>
						{computed.isFetching ? (
							<p role="status">Computing historical values…</p>
						) : null}
						{computed.isError ? (
							<p role="alert">
								{computed.error.message}{" "}
								<button type="button" onClick={() => void computed.refetch()}>
									Retry historical computation
								</button>
							</p>
						) : null}
						{!computed.isError && shared ? (
							shared.status === "unavailable" ? (
								<p>
									Shared definitions unavailable:{" "}
									{shared.reason.replaceAll("_", " ")}.
								</p>
							) : (
								<>
									<p>
										Object version #{record.history_id} · Definition version #
										{shared.definition_history_id} · Evaluator{" "}
										{shared.evaluator_version}
									</p>
									{shared.fields.length ? (
										<dl className="stack">
											{shared.fields.map((field) => (
												<div key={field.definition_id}>
													<dt>
														{field.label} ({field.key}) · Revision{" "}
														{field.revision}, semantics{" "}
														{field.semantics_version}
													</dt>
													<dd>
														{field.status === "evaluated" ? (
															<JsonViewer
																value={field.value}
																defaultTab="json"
															/>
														) : field.status === "error" ? (
															`${field.error.code}: ${field.error.message}`
														) : field.status === "unavailable" ? (
															`Unavailable: ${field.reason.replaceAll("_", " ")}`
														) : (
															"Disabled at this time"
														)}
													</dd>
												</div>
											))}
										</dl>
									) : (
										<p>
											No shared computed fields were defined in the available
											historical definition.
										</p>
									)}
								</>
							)
						) : null}
					</section>
				</details>
			)}
		</>
	);
}
