"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { SearchResourceContext } from "@/components/search-resource-context";
import type { SearchDraft } from "@/lib/advanced-search";
import type { HubuumObject } from "@/lib/api/generated/models";
import { fetchSearchHydration } from "@/lib/api/search-hydration";
import { buildSearchHydration } from "@/lib/search-hydration";

export function SearchRelatedResources({
	root,
	settings,
	pageKey,
}: {
	root: HubuumObject;
	settings: NonNullable<SearchDraft["hydration"]>;
	pageKey: string;
}) {
	const request = buildSearchHydration(settings, root);
	const query = useQuery({
		queryKey: ["search-hydration", pageKey, request],
		queryFn: ({ signal }) => fetchSearchHydration(request, signal),
		staleTime: 60_000,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
	});
	const data = query.data;
	const objects = new Map(data?.objects.map((object) => [object.id, object]));
	return (
		<section
			className="stack"
			aria-label={`Related resources for ${root.name} (#${root.id})`}
			aria-busy={query.isFetching}
		>
			<h3>
				Related resources for {root.name} (#{root.id})
			</h3>
			<p>
				All visible related endpoints in{" "}
				<SearchResourceContext kind="class" id={Number(settings.classId)} />,
				within {settings.depth} edges. Maximum {settings.limit} paths. This
				context is independent of which related-object condition matched.
			</p>
			{query.isFetching && (
				<p role="status">Loading visible related resources…</p>
			)}
			{query.error && (
				<div role="alert" className="error-banner">
					<p>{query.error.message}</p>
					<button
						className="ghost"
						type="button"
						onClick={() => void query.refetch()}
					>
						Retry inspection
					</button>
				</div>
			)}
			{data && !query.isError && (
				<>
					{data.truncated ? (
						<p role="status" className="error-banner">
							Partial neighborhood: more visible paths exist beyond the{" "}
							{data.limit}-path limit. Narrow the class or depth, or increase
							the limit and run search again.
						</p>
					) : (
						<p>All visible paths in this scope are shown.</p>
					)}
					{data.paths.length === 0 ? (
						<p>No visible related objects in this scope.</p>
					) : (
						<>
							<h4>Resources on these paths</h4>
							<ul className="stack">
								{data.objects.map((object) => (
									<li key={object.id}>
										<Link
											href={`/objects/${object.hubuum_class_id}/${object.id}`}
										>
											{object.name} (#{object.id})
										</Link>
										{object.id === root.id
											? " — search result"
											: object.hubuum_class_id === data.target_class_id
												? " — related endpoint"
												: " — path context"}
										<div>
											<SearchResourceContext
												kind="class"
												id={object.hubuum_class_id}
											/>{" "}
											·{" "}
											<SearchResourceContext
												kind="collection"
												id={object.collection_id}
											/>
										</div>
									</li>
								))}
							</ul>
							<h4>Visible paths and connecting relations</h4>
							<ol className="stack">
								{data.paths.map((path) => (
									<li key={JSON.stringify(path)}>
										<div>
											{path.object_ids.map((id, index) => {
												const object = objects.get(id);
												return object ? (
													<span key={id}>
														{index > 0 ? " ↔ " : ""}
														<Link
															href={`/objects/${object.hubuum_class_id}/${id}`}
														>
															{object.name} (#{id})
														</Link>
													</span>
												) : null;
											})}
										</div>
										<div>
											Connecting relations:{" "}
											{path.relation_ids.map((id) => `#${id}`).join(", ")}
										</div>
									</li>
								))}
							</ol>
							<details>
								<summary>Relation metadata ({data.relations.length})</summary>
								<ul className="stack">
									{data.relations.map((relation) => (
										<li key={relation.id}>
											Relation #{relation.id}: object #
											{relation.from_hubuum_object_id} → object #
											{relation.to_hubuum_object_id}; class relation #
											{relation.class_relation_id}; updated{" "}
											{relation.updated_at}; revision {relation.revision}.
										</li>
									))}
								</ul>
							</details>
						</>
					)}
				</>
			)}
		</section>
	);
}
