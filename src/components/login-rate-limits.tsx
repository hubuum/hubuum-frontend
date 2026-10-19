"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JsonViewer } from "@/components/json-viewer";
import { fetchLoginLimits, clearLoginLimits } from "@/lib/api/admin-security";
import { useConfirm } from "@/lib/confirm-context";
export function LoginRateLimits() {
	const [include, setInclude] = useState("locked");
	const [scope, setScope] = useState("");
	const [search, setSearch] = useState("");
	const [params, setParams] = useState({ include: "locked", scope: "", q: "" });
	const client = useQueryClient();
	const confirm = useConfirm();
	const reloadRef = useRef<HTMLButtonElement | null>(null);
	const query = useQuery({
		queryKey: ["login-rate-limits", params],
		queryFn: () =>
			fetchLoginLimits({
				...params,
				scope: params.scope || undefined,
				q: params.q || undefined,
			}),
	});
	const clear = useMutation({
		mutationFn: clearLoginLimits,
		onSuccess: () =>
			client.invalidateQueries({ queryKey: ["login-rate-limits"] }),
	});
	async function release(id?: string) {
		if (clear.isPending) return;
		if (
			await confirm({
				title: id ? "Release this login limit?" : "Clear all login limits?",
				description: id
					? "Remove this scope's failed attempts and lockout."
					: "Remove every tracked scope, including entries outside the current filter.",
				confirmLabel: id ? "Release" : "Clear all",
				tone: "danger",
				restoreFocusFallbackRef: reloadRef,
			})
		)
			clear.mutate(id);
	}
	return (
		<section className="card stack" aria-label="Login rate limits">
			<h3>Login rate limits</h3>
			<form
				className="form-grid"
				onSubmit={(event) => {
					event.preventDefault();
					setParams({ include, scope, q: search.trim() });
					clear.reset();
				}}
			>
				<label className="control-field">
					<span>Entries</span>
					<select value={include} onChange={(e) => setInclude(e.target.value)}>
						<option value="locked">Locked</option>
						<option value="all">All tracked</option>
					</select>
				</label>
				<label className="control-field">
					<span>Scope</span>
					<select value={scope} onChange={(e) => setScope(e.target.value)}>
						<option value="">All scopes</option>
						<option value="user_ip">User and IP</option>
						<option value="ip">IP</option>
						<option value="subnet">Subnet</option>
					</select>
				</label>
				<label className="control-field">
					<span>Identifier contains</span>
					<input value={search} onChange={(e) => setSearch(e.target.value)} />
				</label>
				<button type="submit">Apply filters</button>
			</form>
			<div className="action-row">
				<button
					ref={reloadRef}
					type="button"
					className="secondary"
					aria-disabled={query.isFetching || clear.isPending}
					onClick={() => {
						if (!query.isFetching && !clear.isPending) void query.refetch();
					}}
				>
					Reload limits
				</button>
				<button
					type="button"
					className="danger"
					disabled={clear.isPending || !query.data?.tracked_entries}
					onClick={() => void release()}
				>
					Clear all limits
				</button>
			</div>
			{query.isPending ? <p role="status">Loading login limits…</p> : null}
			{query.isError ? <p role="alert">{query.error.message}</p> : null}
			{clear.isError ? <p role="alert">{clear.error.message}</p> : null}
			{clear.isSuccess ? <p role="status">Login limits updated.</p> : null}
			{query.data ? (
				<>
					<p>
						{query.data.locked_entries} locked / {query.data.tracked_entries}{" "}
						tracked; {query.data.returned_entries} shown. Rate limiting{" "}
						{query.data.config.enabled ? "enabled" : "disabled"}.
					</p>
					<details>
						<summary>Effective rate-limit configuration</summary>
						<JsonViewer value={query.data.config} />
					</details>
					<section
						className="table-wrap"
						aria-label="Login limit entries"
						// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard access.
						tabIndex={0}
					>
						<table>
							<thead>
								<tr>
									<th>Scope</th>
									<th>Identifier</th>
									<th>Attempts</th>
									<th>Lockout</th>
									<th>Backoff level</th>
									<th>Actions</th>
								</tr>
							</thead>
							<tbody>
								{query.data.entries.map((entry) => (
									<tr key={entry.id}>
										<td>{entry.scope}</td>
										<td>{entry.identifier}</td>
										<td>{entry.attempts}</td>
										<td>
											{entry.locked
												? `${entry.locked_for_seconds ?? 0}s remaining`
												: "Unlocked"}
										</td>
										<td>{entry.lockout_level}</td>
										<td>
											<button
												type="button"
												className="secondary"
												disabled={clear.isPending}
												onClick={() => void release(entry.id)}
											>
												Release
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
					{!query.data.entries.length ? <p>No matching login limits.</p> : null}
				</>
			) : null}
		</section>
	);
}
