"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { fetchRelatedGraph } from "@/lib/api/related-graph";
import { graphResourceHref, type GraphScope } from "@/lib/related-graph";
import styles from "./neighborhood-graph.module.css";

export function NeighborhoodGraph({ scope }: { scope: GraphScope }) {
	const [depth, setDepth] = useState("2");
	const [limit, setLimit] = useState("50");
	const [bounds, setBounds] = useState({ depth: 2, limit: 50 });
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const query = useQuery({
		queryKey: ["neighborhood-graph", scope, bounds],
		queryFn: ({ signal }) => fetchRelatedGraph(scope, bounds, signal),
		retry: false,
	});
	const graph = query.data;
	const selected =
		graph?.nodes.find((node) => node.id === selectedId) ??
		graph?.nodes.find((node) => node.id === graph.rootId);
	const nodesById = new Map(graph?.nodes.map((node) => [node.id, node]));
	return (
		<section
			className={`stack ${styles.workspace}`}
			aria-label="Neighborhood graph"
		>
			<header className="stack">
				<h1>
					{scope.type === "class" ? "Class" : "Object"} neighborhood graph
				</h1>
				<Link href={graphResourceHref(scope)}>Back to {scope.type}</Link>
				<p>
					Explore visible connections from this {scope.type}. Columns show the
					shortest distance from the root; lines show direct relations within
					the returned neighborhood.
				</p>
			</header>
			<form
				className={`card ${styles.controls}`}
				onSubmit={(event) => {
					event.preventDefault();
					const next = { depth: Number(depth), limit: Number(limit) };
					if (next.depth === bounds.depth && next.limit === bounds.limit)
						void query.refetch();
					else setBounds(next);
				}}
			>
				<label className="stack">
					Maximum depth
					<input
						type="number"
						min="1"
						max="10"
						required
						value={depth}
						onChange={(event) => setDepth(event.target.value)}
					/>
				</label>
				<label className="stack">
					Maximum related nodes
					<select
						value={limit}
						onChange={(event) => setLimit(event.target.value)}
					>
						{[25, 50, 100, 250].map((value) => (
							<option key={value} value={value}>
								{value}
							</option>
						))}
					</select>
				</label>
				<button type="submit" disabled={query.isFetching}>
					Load graph
				</button>
				<p className="muted">
					The node limit is a safety bound, not a page size. Reduce the depth if
					the server rejects an oversized neighborhood.
				</p>
			</form>
			{query.isFetching ? <p role="status">Loading neighborhood…</p> : null}
			{query.isError ? (
				<p role="alert" className="error-banner">
					{query.error.message}
				</p>
			) : null}
			{graph && !query.isError ? (
				<>
					<p role="status">
						{graph.nodes.length} nodes, including the root ·{" "}
						{graph.edges.length} direct relations · maximum depth {bounds.depth}
					</p>
					<section
						className={styles.viewport}
						aria-label="Neighborhood diagram"
					>
						<div
							className={styles.canvas}
							style={{ width: graph.width, height: graph.height }}
						>
							<svg
								className={styles.edges}
								width={graph.width}
								height={graph.height}
								aria-hidden="true"
							>
								{graph.edges.map((edge) => {
									const from = nodesById.get(edge.from);
									const to = nodesById.get(edge.to);
									if (!from || !to) return null;
									return (
										<line
											key={edge.id}
											className={`${styles.edge} ${edge.from === selected?.id || edge.to === selected?.id ? styles.incident : ""}`}
											x1={from.x + 106}
											y1={from.y + 30}
											x2={to.x + 106}
											y2={to.y + 30}
										/>
									);
								})}
							</svg>
							{graph.nodes.map((node) => (
								<button
									key={node.id}
									type="button"
									className={styles.node}
									style={{ left: node.x, top: node.y }}
									aria-label={`Inspect ${node.name} (#${node.id})`}
									aria-pressed={selected?.id === node.id}
									onClick={() => setSelectedId(node.id)}
								>
									<span>{node.name}</span>
									<small>
										#{node.id} ·{" "}
										{node.id === graph.rootId
											? "Root"
											: `Depth ${node.path.length - 1}`}
									</small>
								</button>
							))}
						</div>
					</section>
					{selected ? (
						<section
							className="card stack"
							aria-label="Selected node"
							aria-live="polite"
						>
							<h2>
								{selected.name} (#{selected.id})
							</h2>
							<p>{selected.description || "No description"}</p>
							<p>
								Shortest path:{" "}
								{selected.path
									.map((id) => nodesById.get(id)?.name ?? `#${id}`)
									.join(" → ")}
							</p>
							<Link href={selected.href}>Open {scope.type}</Link>
						</section>
					) : null}
					<details className="card stack">
						<summary>Nodes ({graph.nodes.length})</summary>
						<div className="table-wrap">
							<table>
								<caption>Neighborhood nodes</caption>
								<thead>
									<tr>
										<th>Node</th>
										<th>Distance</th>
										<th>Shortest path (IDs)</th>
									</tr>
								</thead>
								<tbody>
									{graph.nodes.map((node) => (
										<tr key={node.id}>
											<td>
												<Link href={node.href}>
													{node.name} (#{node.id})
												</Link>
											</td>
											<td>{node.path.length - 1}</td>
											<td>{node.path.join(" → ")}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</details>
					<details className="card stack">
						<summary>Direct relations ({graph.edges.length})</summary>
						<p>From and To show the stored relation direction.</p>
						<div className="table-wrap">
							<table>
								<caption>Direct neighborhood relations</caption>
								<thead>
									<tr>
										<th>Relation ID</th>
										<th>From</th>
										<th>To</th>
									</tr>
								</thead>
								<tbody>
									{graph.edges.map((edge) => (
										<tr key={edge.id}>
											<td>{edge.id}</td>
											<td>
												{nodesById.get(edge.from)?.name} (#{edge.from})
											</td>
											<td>
												{nodesById.get(edge.to)?.name} (#{edge.to})
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</details>
				</>
			) : null}
		</section>
	);
}
