"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { QueryUsageAnalysis } from "@/components/query-usage-analysis";
import { QueryUsagePatternForm } from "@/components/query-usage-pattern-form";
import { fetchExpandedClass } from "@/lib/api/classes";
import type {
	QueryUsagePatternSchema,
	QueryUsageResponse,
} from "@/lib/api/generated/models";
import {
	createQueryUsage,
	deleteQueryUsage,
	fetchQueryUsage,
	QueryUsageApiError,
	replaceQueryUsage,
} from "@/lib/api/query-usage";
import { useConfirm } from "@/lib/confirm-context";
import { queryUsagePatternLabel } from "@/lib/query-usage";
import { useToast } from "@/lib/toast-context";

type Editor = {
	declaration?: QueryUsageResponse;
	pattern?: QueryUsagePatternSchema;
};

function MutationError({ error }: { error: Error | null }) {
	if (!error) return null;
	return (
		<div className="error-banner" role="alert">
			<p>{error.message}</p>
			{error instanceof QueryUsageApiError && error.status === 409 ? (
				<p>
					The declaration may have changed, already exist, or exceed the class
					limit. Reload declarations and reopen the editor to review current
					state before trying again.
				</p>
			) : error instanceof QueryUsageApiError && error.status === 403 ? (
				<p>Changing declarations requires permission to update this class.</p>
			) : null}
		</div>
	);
}

export function ClassQueryUsageWorkspace({
	classId,
	canAnalyze,
}: {
	classId: number;
	canAnalyze: boolean;
}) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const { showToast } = useToast();
	const [editor, setEditor] = useState<Editor | null>(null);
	const reloadRef = useRef<HTMLButtonElement | null>(null);
	const classQuery = useQuery({
		queryKey: ["class", classId],
		queryFn: ({ signal }) => fetchExpandedClass(classId, signal),
		retry: false,
	});
	const declarations = useQuery({
		queryKey: ["query-usage", classId, "declarations"],
		queryFn: ({ signal }) => fetchQueryUsage(classId, signal),
		retry: false,
	});
	async function refresh() {
		await queryClient.invalidateQueries({ queryKey: ["query-usage", classId] });
	}
	const save = useMutation({
		mutationFn: ({
			context,
			pattern,
		}: {
			context: Editor;
			pattern: QueryUsagePatternSchema;
		}) =>
			context.declaration
				? replaceQueryUsage(classId, context.declaration, pattern)
				: createQueryUsage(classId, pattern),
		onSuccess: async () => {
			showToast("Query usage declaration saved.", "success");
			await refresh();
		},
	});
	const remove = useMutation({
		mutationFn: (declaration: QueryUsageResponse) =>
			deleteQueryUsage(classId, declaration),
		onSuccess: async () => {
			showToast(
				"Declaration withdrawn. Native cleanup occurs during operator reconciliation.",
				"success",
			);
			await refresh();
		},
	});
	const busy = save.isPending || remove.isPending;
	function openEditor(context: Editor) {
		save.reset();
		setEditor(context);
	}
	async function withdraw(declaration: QueryUsageResponse) {
		if (busy) return;
		if (
			await confirm({
				title: `Withdraw ${declaration.pattern.path}?`,
				description:
					"This removes the declaration at its current revision. Shared resources remain until the last owner withdraws and an operator reconciles cleanup. Queries continue to work.",
				confirmLabel: "Withdraw declaration",
				tone: "danger",
				restoreFocusFallbackRef: reloadRef,
			})
		)
			remove.mutate(declaration);
	}
	return (
		<section className="stack query-usage-workspace">
			<header className="stack">
				<Link href={`/classes/${classId}`}>Back to class</Link>
				<h1>Query usage · {classQuery.data?.name ?? `Class #${classId}`}</h1>
				<p>
					Record expected JSON queries independently of the schema. Declarations
					do not change validation or query results and do not promise an index
					or a speedup.
				</p>
			</header>
			{classQuery.isError ? (
				<p role="alert">{classQuery.error.message}</p>
			) : null}
			<section className="card stack" aria-label="Query usage declarations">
				<div className="panel-header">
					<h2>Declarations ({declarations.data?.length ?? 0}/32)</h2>
					<div className="action-row">
						<button
							ref={reloadRef}
							type="button"
							className="ghost"
							aria-disabled={busy || declarations.isFetching}
							onClick={() => {
								if (!busy && !declarations.isFetching) void refresh();
							}}
						>
							Reload declarations
						</button>
						<button
							type="button"
							disabled={
								busy ||
								!declarations.isSuccess ||
								declarations.data.length >= 32
							}
							onClick={() => openEditor({})}
						>
							New declaration
						</button>
					</div>
				</div>
				<p className="muted">
					Reading requires class read access; creating, editing, and withdrawing
					require class update access. Schema compatibility is advisory.
				</p>
				{declarations.isPending ? (
					<p role="status">Loading declarations…</p>
				) : null}
				{declarations.isError ? (
					<p role="alert">
						{declarations.error instanceof QueryUsageApiError &&
						declarations.error.status === 404
							? "Query usage declarations are unavailable for this class or server."
							: declarations.error.message}
					</p>
				) : null}
				<MutationError error={remove.error} />
				{declarations.isSuccess && declarations.data.length === 0 ? (
					<p>No query usage declarations yet.</p>
				) : null}
				{declarations.isSuccess
					? declarations.data.map((declaration) => (
							<article
								className="card stack"
								key={declaration.id}
								aria-label={`Declaration ${declaration.pattern.path}`}
							>
								<h3>{queryUsagePatternLabel(declaration.pattern)}</h3>
								<p>
									Declaration #{declaration.id} · Revision{" "}
									{declaration.revision} · Schema:{" "}
									{declaration.schema_compatibility}
								</p>
								<details>
									<summary>Provenance</summary>
									<dl className="query-usage-facts">
										<dt>Created</dt>
										<dd>{declaration.created_at}</dd>
										<dt>Created by</dt>
										<dd>
											{declaration.created_by == null
												? "Not recorded"
												: `Principal #${declaration.created_by}`}
										</dd>
										<dt>Updated</dt>
										<dd>{declaration.updated_at}</dd>
										<dt>Updated by</dt>
										<dd>
											{declaration.updated_by == null
												? "Not recorded"
												: `Principal #${declaration.updated_by}`}
										</dd>
									</dl>
								</details>
								<div className="action-row">
									<button
										type="button"
										className="ghost"
										disabled={busy}
										onClick={() =>
											openEditor({ declaration, pattern: declaration.pattern })
										}
									>
										Edit declaration
									</button>
									<button
										type="button"
										className="danger"
										disabled={busy}
										onClick={() => void withdraw(declaration)}
									>
										Withdraw declaration
									</button>
									<Link
										href={`/audit?entityType=query_usage_declaration&entityId=${declaration.id}`}
									>
										Audit history
									</Link>
								</div>
							</article>
						))
					: null}
			</section>
			{canAnalyze && declarations.isSuccess ? (
				<QueryUsageAnalysis
					classId={classId}
					declarations={declarations.data}
					busy={busy}
					onAdopt={(pattern) => openEditor({ pattern })}
				/>
			) : !canAnalyze ? (
				<p className="info-banner">
					Workload analysis and native resource inspection require unscoped
					administrator access and permission to read this class.
				</p>
			) : null}
			<CreateModal
				open={editor !== null}
				title={
					editor?.declaration
						? "Edit query usage declaration"
						: "Create query usage declaration"
				}
				closeDisabled={busy}
				restoreFocusFallbackRef={reloadRef}
				onClose={() => setEditor(null)}
			>
				{editor ? (
					<div className="stack">
						<QueryUsagePatternForm
							label="Declaration pattern"
							initial={editor.pattern}
							submitLabel={save.isPending ? "Saving…" : "Save declaration"}
							disabled={busy}
							onSubmit={(pattern) =>
								save.mutate(
									{ context: editor, pattern },
									// Close after refresh and mutation settlement enable the trigger.
									{ onSuccess: () => setEditor(null) },
								)
							}
							onCancel={() => setEditor(null)}
						/>
						<MutationError error={save.error} />
					</div>
				) : null}
			</CreateModal>
		</section>
	);
}
