"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import {
	classFieldInventoryQueryKey,
	DEFAULT_FIELD_DISCOVERY,
	fetchClassFieldInventory,
} from "@/lib/api/field-discovery";
import type {
	ClassFieldInventory,
	FieldSource,
} from "@/lib/api/generated/models";

const SOURCES: Record<FieldSource, string> = {
	data: "Object data",
	shared_computed: "Shared computed",
	personal_computed: "Personal computed",
};

export function FieldDiscoverySummary({
	inventory,
}: {
	inventory?: ClassFieldInventory;
}) {
	if (!inventory) return null;
	return (
		<p className="muted">
			Sampled {inventory.sampled_objects} authorized objects (limit{" "}
			{inventory.effective_sample_limit}, depth {inventory.max_depth}). Counts
			describe this sample, not the whole class.
			{inventory.truncation.length
				? ` Discovery was limited: ${inventory.truncation.map((reason) => reason.replaceAll("_", " ")).join(", ")}.`
				: ""}
		</p>
	);
}

export function FieldDiscoveryPanel({ classId }: { classId: number }) {
	const id = useId();
	const [search, setSearch] = useState("");
	const [source, setSource] = useState("all");
	const [limit, setLimit] = useState("100");
	const [depth, setDepth] = useState("6");
	const [options, setOptions] = useState<{
		limit: number;
		depth: number;
		containers: boolean;
	}>(DEFAULT_FIELD_DISCOVERY);
	const query = useQuery({
		queryKey: classFieldInventoryQueryKey(classId, options),
		queryFn: ({ signal }) => fetchClassFieldInventory(classId, options, signal),
		retry: false,
	});
	const validOptions =
		/^\d+$/.test(limit) &&
		Number(limit) >= 1 &&
		Number(limit) <= 250 &&
		/^\d+$/.test(depth) &&
		Number(depth) <= 32;
	const fields = (query.data?.fields ?? []).filter(
		(field) =>
			(source === "all" || field.source === source) &&
			`${field.field} ${Object.keys(field.types).join(" ")}`
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase()),
	);
	return (
		<section
			id="class-field-discovery"
			className="card stack"
			aria-labelledby={`${id}-heading`}
		>
			<div>
				<h2 id={`${id}-heading`}>Discover fields</h2>
				<p className="muted">
					Explore object data and computed values available to you. Use
					discovered data fields when building computed fields or export
					templates.
				</p>
			</div>
			<form
				className="action-row"
				onSubmit={(event) => {
					event.preventDefault();
					if (!validOptions) return;
					const next = {
						...options,
						limit: Number(limit),
						depth: Number(depth),
					};
					if (next.limit === options.limit && next.depth === options.depth)
						void query.refetch();
					else setOptions(next);
				}}
			>
				<label className="control-field">
					<span>Sample limit</span>
					<input
						type="number"
						min={1}
						max={250}
						step={1}
						value={limit}
						onChange={(event) => setLimit(event.target.value)}
						required
					/>
				</label>
				<label className="control-field">
					<span>Discovery depth</span>
					<input
						type="number"
						min={0}
						max={32}
						step={1}
						value={depth}
						onChange={(event) => setDepth(event.target.value)}
						required
					/>
				</label>
				<button type="submit" disabled={!validOptions || query.isFetching}>
					{query.isFetching ? "Discovering fields…" : "Refresh fields"}
				</button>
				<Link href={`/classes/${classId}/schema?step=schema`}>
					Suggest a schema
				</Link>
			</form>
			<FieldDiscoverySummary inventory={query.data} />
			<div className="action-row">
				<label className="control-field">
					<span>Search discovered fields</span>
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Field name or type"
					/>
				</label>
				<label className="control-field">
					<span>Field source</span>
					<select
						value={source}
						onChange={(event) => setSource(event.target.value)}
					>
						<option value="all">All sources</option>
						{Object.entries(SOURCES).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</label>
			</div>
			{query.error ? (
				<p role="alert" className="error-banner">
					{query.error.message}
				</p>
			) : null}
			{query.isLoading ? (
				<p role="status">Discovering fields…</p>
			) : query.data ? (
				<>
					<p role="status">{fields.length} matching fields</p>
					{fields.length ? (
						<div className="table-wrap">
							<table>
								<caption className="muted">
									Observed fields and bounded value previews
								</caption>
								<thead>
									<tr>
										<th scope="col">Field</th>
										<th scope="col">Source</th>
										<th scope="col">Types and occurrences</th>
										<th scope="col">Objects</th>
										<th scope="col">Example preview</th>
									</tr>
								</thead>
								<tbody>
									{fields.map((field) => (
										<tr key={`${field.source}:${JSON.stringify(field.path)}`}>
											<td>
												<code>{field.field}</code>
												<details>
													<summary>Structured path</summary>
													<pre>{JSON.stringify(field.path, null, 2)}</pre>
												</details>
											</td>
											<td>{SOURCES[field.source]}</td>
											<td>
												{Object.entries(field.types)
													.map(([type, count]) => `${type}: ${count}`)
													.join(", ") || "No values"}
												{field.error_count ? (
													<p>{field.error_count} evaluation errors</p>
												) : null}
											</td>
											<td>
												{field.object_count} / {query.data.sampled_objects}
												<br />
												<small>{field.observation_count} occurrences</small>
											</td>
											<td>
												<code>{field.example ?? "No preview"}</code>
												{field.example_truncated ? (
													<small> (truncated)</small>
												) : null}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p>No fields match. Adjust the search, source, or sample bounds.</p>
					)}
				</>
			) : null}
		</section>
	);
}
