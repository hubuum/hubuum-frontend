"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { TablePagination } from "@/components/table-pagination";
import { fetchClientPaginationConfig } from "@/lib/api/client-config";
import { fetchRelatedGraph } from "@/lib/api/related-graph";
import {
	graphResourceHref,
	MAX_GRAPH_NODES,
	type GraphScope,
} from "@/lib/related-graph";
import styles from "./neighborhood-graph.module.css";

export function NeighborhoodGraph({ scope }: { scope: GraphScope }) {
	const [depth, setDepth] = useState("2");
	const config = useQuery({
		queryKey: ["client-config", "pagination"],
		queryFn: fetchClientPaginationConfig,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
	const maximum = Math.min(MAX_GRAPH_NODES, config.data?.max_page_limit ?? 250);
	const [limit, setLimit] = useState<number | null>(null);
	const [includeSameClass, setIncludeSameClass] = useState(false);
	const [requested, setRequested] = useState({
		depth: 2,
		limit: null as number | null,
		includeSameClass: false,
	});
	const bounds = {
		...requested,
		limit: Math.min(requested.limit ?? 250, maximum),
	};
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [zoom, setZoom] = useState(1);
	const [search, setSearch] = useState("");
	const [nodePage, setNodePage] = useState(0);
	const [edgePage, setEdgePage] = useState(0);
	const viewportRef = useRef<HTMLElement>(null);
	const query = useQuery({
		queryKey: ["neighborhood-graph", scope, bounds],
		queryFn: ({ signal }) => fetchRelatedGraph(scope, bounds, signal),
		enabled: !config.isPending,
		retry: false,
	});
	const graph = query.data;
	const selected =
		graph?.nodes.find((node) => node.id === selectedId) ??
		graph?.nodes.find((node) => node.id === graph.rootId);
	const nodesById = new Map(graph?.nodes.map((node) => [node.id, node]));
	const matchingNodes =
		graph?.nodes.filter((node) =>
			`${node.name} #${node.id}`
				.toLocaleLowerCase()
				.includes(search.toLocaleLowerCase()),
		) ?? [];
	const visibleNodes = matchingNodes.slice(nodePage * 50, (nodePage + 1) * 50);
	function focusNode(id: number) {
		setSelectedId(id);
		setZoom(1);
		requestAnimationFrame(() => {
			const node = viewportRef.current?.querySelector<HTMLButtonElement>(
				`[data-node-id="${id}"]`,
			);
			node?.focus({ preventScroll: true });
			node?.scrollIntoView({
				block: "center",
				inline: "center",
				behavior: "auto",
			});
		});
	}
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
					const next = {
						depth: Number(depth),
						limit: Math.min(limit ?? 250, maximum),
						includeSameClass,
					};
					setNodePage(0);
					setEdgePage(0);
					setSelectedId(null);
					if (
						next.depth === bounds.depth &&
						next.limit === bounds.limit &&
						next.includeSameClass === bounds.includeSameClass
					)
						void query.refetch();
					else setRequested(next);
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
						value={Math.min(limit ?? 250, maximum)}
						onChange={(event) => setLimit(Number(event.target.value))}
					>
						{[
							...new Set([
								25,
								50,
								100,
								250,
								500,
								1000,
								MAX_GRAPH_NODES,
								maximum,
							]),
						]
							.filter((value) => value <= maximum)
							.sort((a, b) => a - b)
							.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
					</select>
				</label>
				{scope.type === "object" ? (
					<label className="control-check">
						<input
							type="checkbox"
							checked={includeSameClass}
							onChange={(event) => setIncludeSameClass(event.target.checked)}
						/>
						<span>Include objects of the same class</span>
					</label>
				) : null}
				<button type="submit" disabled={query.isFetching}>
					Load graph
				</button>
				<p className="muted">
					Up to {maximum} related nodes with this server. Reduce the depth
					{scope.type === "object" ? " or exclude same-class objects" : ""} if
					the neighborhood exceeds that bound.
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
					{scope.type === "object" && !bounds.includeSameClass ? (
						<p className="muted">
							Objects in the root&apos;s class are excluded; the root stays
							visible. Shortest paths may pass through excluded objects.
						</p>
					) : null}
					<div className={styles.controls}>
						<button
							type="button"
							className="ghost"
							disabled={zoom <= 0.1}
							onClick={() => setZoom(Math.max(0.1, zoom - 0.1))}
						>
							Zoom out
						</button>
						<output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
						<button
							type="button"
							className="ghost"
							disabled={zoom >= 2}
							onClick={() => setZoom(Math.min(2, zoom + 0.1))}
						>
							Zoom in
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() =>
								setZoom(
									Math.min(
										1,
										(viewportRef.current?.clientWidth ?? graph.width) /
											graph.width,
									),
								)
							}
						>
							Fit width
						</button>
						<button
							type="button"
							className="ghost"
							onClick={() => {
								setZoom(1);
								if (selected) focusNode(selected.id);
							}}
						>
							Actual size
						</button>
					</div>
					<section
						className={styles.viewport}
						aria-label="Neighborhood diagram"
						ref={viewportRef}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: The scrollable diagram needs keyboard access.
						tabIndex={0}
						onKeyDownCapture={(event) => {
							if (
								["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
									event.key,
								)
							)
								event.stopPropagation();
						}}
					>
						<div
							className={styles.scaledCanvas}
							style={{ width: graph.width * zoom, height: graph.height * zoom }}
						>
							<div
								className={styles.canvas}
								style={{
									width: graph.width,
									height: graph.height,
									transform: `scale(${zoom})`,
									transformOrigin: "top left",
								}}
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
										data-node-id={node.id}
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
						<label className="control-field">
							<span>Search loaded nodes</span>
							<input
								type="search"
								value={search}
								onChange={(event) => {
									setSearch(event.target.value);
									setNodePage(0);
								}}
								placeholder="Name or ID"
							/>
						</label>
						<div className="table-wrap">
							<table>
								<caption>Neighborhood nodes</caption>
								<thead>
									<tr>
										<th>Node</th>
										<th>Distance</th>
										<th>Shortest path (IDs)</th>
										<th>Inspect</th>
									</tr>
								</thead>
								<tbody>
									{visibleNodes.map((node) => (
										<tr key={node.id}>
											<td>
												<Link href={node.href}>
													{node.name} (#{node.id})
												</Link>
											</td>
											<td>{node.path.length - 1}</td>
											<td>{node.path.join(" → ")}</td>
											<td>
												<button
													type="button"
													className="ghost"
													onClick={() => focusNode(node.id)}
													aria-label={`Focus ${node.name} in diagram`}
												>
													Focus
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{!matchingNodes.length ? (
							<p>No loaded nodes match this search.</p>
						) : null}
						<TablePagination
							hasNextPage={(nodePage + 1) * 50 < matchingNodes.length}
							hasPrevPage={nodePage > 0}
							onNextPage={() => setNodePage(nodePage + 1)}
							onPrevPage={() => setNodePage(nodePage - 1)}
							onFirstPage={() => setNodePage(0)}
							currentCount={visibleNodes.length}
							totalCount={matchingNodes.length}
						/>
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
									{graph.edges
										.slice(edgePage * 50, (edgePage + 1) * 50)
										.map((edge) => (
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
						<TablePagination
							hasNextPage={(edgePage + 1) * 50 < graph.edges.length}
							hasPrevPage={edgePage > 0}
							onNextPage={() => setEdgePage(edgePage + 1)}
							onPrevPage={() => setEdgePage(edgePage - 1)}
							onFirstPage={() => setEdgePage(0)}
							currentCount={
								graph.edges.slice(edgePage * 50, (edgePage + 1) * 50).length
							}
							totalCount={graph.edges.length}
						/>
					</details>
				</>
			) : null}
		</section>
	);
}
