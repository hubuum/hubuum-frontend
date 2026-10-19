"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchEffectiveAccess } from "@/lib/api/admin-security";
export function EffectiveAccessInspector() {
	const [collection, setCollection] = useState("");
	const [kind, setKind] = useState<"principal" | "group">("principal");
	const [id, setId] = useState("");
	const [selection, setSelection] = useState<{
		collection: number;
		kind: "principal" | "group";
		id: number;
	}>();
	const query = useQuery({
		queryKey: ["admin-effective-access", selection],
		queryFn: () =>
			fetchEffectiveAccess(
				selection!.collection,
				selection!.kind,
				selection!.id,
			),
		enabled: !!selection,
	});
	return (
		<section className="card stack" aria-label="Effective permissions">
			<h3>Effective permissions</h3>
			<p>
				Inspect direct and inherited grants for a principal or group on a
				collection.
			</p>
			<form
				className="form-grid"
				onSubmit={(e) => {
					e.preventDefault();
					setSelection({
						collection: Number(collection),
						kind,
						id: Number(id),
					});
				}}
			>
				<label className="control-field">
					<span>Collection ID</span>
					<input
						type="number"
						required
						min={1}
						max={2147483647}
						step={1}
						value={collection}
						onChange={(e) => setCollection(e.target.value)}
					/>
				</label>
				<label className="control-field">
					<span>Permission subject</span>
					<select
						value={kind}
						onChange={(e) => setKind(e.target.value as "principal" | "group")}
					>
						<option value="principal">Principal</option>
						<option value="group">Group</option>
					</select>
				</label>
				<label className="control-field">
					<span>Subject ID</span>
					<input
						type="number"
						required
						min={1}
						max={2147483647}
						step={1}
						value={id}
						onChange={(e) => setId(e.target.value)}
					/>
				</label>
				<button type="submit">Inspect permissions</button>
			</form>
			{query.isFetching ? <p role="status">Loading permissions…</p> : null}
			{query.isError ? <p role="alert">{query.error.message}</p> : null}
			{selection && query.data ? (
				<>
					<p>
						Collection #{selection.collection} · {selection.kind} #
						{selection.id}
					</p>
					{!query.data.length ? (
						<p>No effective collection grants.</p>
					) : (
						<section
							className="table-wrap"
							aria-label="Effective permission grants"
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard access.
							tabIndex={0}
						>
							<table>
								<thead>
									<tr>
										<th>Group</th>
										<th>Source collection</th>
										<th>Inheritance</th>
										<th>Permissions</th>
									</tr>
								</thead>
								<tbody>
									{query.data.map((entry) => (
										<tr
											key={`${entry.source_collection.id}-${entry.group.id}-${entry.permission.id}`}
										>
											<td>
												{entry.group.groupname} (#{entry.group.id})
											</td>
											<td>
												<Link
													href={`/collections/${entry.source_collection.id}`}
												>
													{entry.source_collection.name}
												</Link>
											</td>
											<td>
												{entry.inherited
													? `Inherited · depth ${entry.depth}`
													: "Direct"}
											</td>
											<td>
												{Object.entries(entry.permission)
													.filter(
														([key, value]) =>
															key.startsWith("has_") && value === true,
													)
													.map(([key]) => key.slice(4).replaceAll("_", " "))
													.join(", ") || "None"}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</section>
					)}
				</>
			) : null}
		</section>
	);
}
