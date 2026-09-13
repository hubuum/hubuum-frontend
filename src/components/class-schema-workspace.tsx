"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { SchemaCompliancePanel } from "@/components/schema-compliance-panel";
import { SchemaRevisionHistory } from "@/components/schema-revision-history";
import { SchemaWorkReport } from "@/components/schema-work-report";
import { fetchExpandedClass } from "@/lib/api/classes";
import type {
	SchemaActivationPolicy,
	SchemaRevisionResponse,
} from "@/lib/api/generated/models";
import { buildObjectDataPatchPlan } from "@/lib/api/object-data-patch";
import {
	abandonSchema,
	activateSchema,
	cancelSchemaWork,
	fetchActiveSchema,
	fetchSchemaRevision,
	fetchSchemaSummary,
	fetchSchemaWork,
	SchemaApiError,
	stageSchema,
	startSchemaWork,
} from "@/lib/api/schema-evolution";
import { useConfirm } from "@/lib/confirm-context";
import {
	parseSchemaDraft,
	positiveSchemaId,
	schemaActivationBlock,
	schemaDocument,
} from "@/lib/schema-evolution";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

const JsonEditor = dynamic(
	() => import("@/components/json-editor").then((module) => module.JsonEditor),
	{
		loading: () => <p role="status">Loading editor…</p>,
	},
);

type Step = "propose" | "review" | "impact" | "activate";
type Draft = { input: string; enforce: boolean; base: SchemaRevisionResponse };
const steps: Step[] = ["propose", "review", "impact", "activate"];

export function ClassSchemaWorkspace({ classId }: { classId: number }) {
	const router = useRouter();
	const params = useSearchParams();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const revisionId = positiveSchemaId(params.get("revision"));
	const taskId = positiveSchemaId(params.get("task"));
	const rebuildId = positiveSchemaId(params.get("rebuild"));
	const requestedStep = params.get("step") as Step;
	const step = steps.includes(requestedStep) ? requestedStep : "propose";
	const view = params.get("view") ?? "flow";
	const [draft, setDraft] = useState<Draft | null>(null);
	const checkedDraft = useDebouncedValue(draft, 250);
	const checkingDraft = draft !== checkedDraft;
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [reportInput, setReportInput] = useState("");
	const classQuery = useQuery({
		queryKey: ["class", classId],
		queryFn: ({ signal }) => fetchExpandedClass(classId, signal),
	});
	const activeQuery = useQuery({
		queryKey: ["schema", classId, "active"],
		queryFn: ({ signal }) => fetchActiveSchema(classId, signal),
		retry: false,
	});
	const summaryQuery = useQuery({
		queryKey: ["schema", classId, "summary"],
		queryFn: ({ signal }) => fetchSchemaSummary(classId, signal),
		retry: false,
	});
	const active = activeQuery.data;
	const revisionQuery = useQuery({
		queryKey: ["schema", classId, "revision", revisionId],
		queryFn: ({ signal }) =>
			fetchSchemaRevision(classId, revisionId as number, signal),
		enabled: revisionId !== null,
		retry: false,
	});
	const candidate = revisionId === null ? active : revisionQuery.data;
	// A successful summary read establishes actual report access, including token scope.
	const canReadReports = summaryQuery.isSuccess && summaryQuery.data !== null;
	const workQuery = useQuery({
		queryKey: ["schema", classId, "work", taskId],
		queryFn: ({ signal }) => fetchSchemaWork(classId, taskId as number, signal),
		enabled: taskId !== null && canReadReports,
		retry: false,
		// Readiness can become stale even after completion. Poll only the bounded report.
		refetchInterval: (query) =>
			query.state.status === "error"
				? false
				: query.state.data?.status === "running"
					? 2000
					: query.state.data?.kind === "impact"
						? 10000
						: false,
	});
	const work = workQuery.data;
	const matchingWork =
		work?.target.class_id === classId &&
		work.target.revision === candidate?.revision
			? work
			: undefined;

	function navigate(values: Record<string, string | number | null>) {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(values)) {
			if (value === null) next.delete(key);
			else next.set(key, String(value));
		}
		router.replace(`/classes/${classId}/schema?${next}`, { scroll: false });
	}

	async function refreshSchema() {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["schema", classId] }),
			queryClient.invalidateQueries({ queryKey: ["class", classId] }),
			queryClient.invalidateQueries({ queryKey: ["classes"] }),
			queryClient.invalidateQueries({ queryKey: ["tasks"] }),
		]);
	}

	const workStatus = work?.status;
	useEffect(() => {
		if (!workStatus || workStatus === "running") return;
		void queryClient.invalidateQueries({
			queryKey: ["schema", classId, "summary"],
		});
		void queryClient.invalidateQueries({
			queryKey: ["schema", classId, "compliance"],
		});
	}, [classId, queryClient, workStatus]);

	useEffect(() => {
		if (!draft) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [draft]);

	function onError(cause: Error) {
		setError(
			cause instanceof SchemaApiError && cause.status === 409
				? `${cause.message} The proposal is retained. Review the current schema and run a fresh analysis before retrying.`
				: cause.message,
		);
		if (
			cause instanceof SchemaApiError &&
			(cause.status === 409 || cause.status === 403)
		)
			void refreshSchema();
	}
	const stageMutation = useMutation({
		mutationFn: async () => {
			if (!draft) throw new Error("Start a proposal first.");
			return stageSchema(classId, parseSchemaDraft(draft.input, draft.enforce));
		},
		onSuccess: async (revision) => {
			setDraft(null);
			setNotice(
				revision.status === "active"
					? "This policy is already active. No new revision was needed."
					: `Revision ${revision.revision} is saved. The active schema has not changed.`,
			);
			navigate({
				revision: revision.revision,
				task: null,
				rebuild: null,
				step: "review",
			});
			await refreshSchema();
		},
		onError,
	});
	const startMutation = useMutation({
		mutationFn: async (kind: "impact" | "revalidation") => {
			const target = kind === "impact" ? candidate : active;
			if (!target) throw new Error("Load a schema revision first.");
			return startSchemaWork(classId, target.revision, kind);
		},
		onSuccess: async (result) => {
			queryClient.setQueryData(
				["schema", classId, "work", result.task_id],
				result,
			);
			navigate({
				revision: result.target.revision,
				task: result.task_id,
				step: result.kind === "impact" ? "impact" : "activate",
				view: "flow",
			});
			await refreshSchema();
		},
		onError,
	});
	const activationMutation = useMutation({
		mutationFn: async (policy: SchemaActivationPolicy) => {
			if (!candidate || !active || draft)
				throw new Error("Save and review a revision first.");
			if (policy === "reject_incompatible") {
				// Refresh readiness without silently changing the user's reviewed baseline.
				const latestWork =
					matchingWork?.kind === "impact"
						? await fetchSchemaWork(classId, matchingWork.task_id)
						: undefined;
				const block = schemaActivationBlock(
					candidate,
					active,
					summaryQuery.data,
					latestWork,
				);
				if (block) throw new Error(block);
			}
			return activateSchema(classId, candidate.revision, {
				expected_active_revision: active.revision,
				policy,
				...(policy === "reject_incompatible" && matchingWork?.kind === "impact"
					? { impact_task_id: matchingWork.task_id }
					: {}),
			});
		},
		onSuccess: async (result) => {
			setNotice(
				`Revision ${result.active.revision} is now active. Existing object data is unchanged.`,
			);
			navigate({
				revision: result.active.revision,
				task: result.task_id ?? null,
				rebuild: result.dependent_rebuild_task_id ?? null,
				step: "activate",
			});
			await refreshSchema();
		},
		onError,
	});
	const abandonMutation = useMutation({
		mutationFn: () => abandonSchema(classId, candidate?.revision as number),
		onSuccess: async () => {
			setNotice("The staged revision was abandoned.");
			await refreshSchema();
		},
		onError,
	});
	const cancelMutation = useMutation({
		mutationFn: () =>
			cancelSchemaWork(classId, matchingWork?.task_id as number),
		onSuccess: async () => {
			setNotice("Work cancelled. Completed batches are retained.");
			await refreshSchema();
		},
		onError,
	});
	const busy =
		stageMutation.isPending ||
		startMutation.isPending ||
		activationMutation.isPending ||
		abandonMutation.isPending ||
		cancelMutation.isPending;

	async function discardDraft() {
		if (
			draft &&
			!(await confirm({
				title: "Discard this unsaved proposal?",
				description: "The draft has not been saved as a revision.",
				confirmLabel: "Discard draft",
				tone: "danger",
			}))
		)
			return;
		setDraft(null);
		setError(null);
		navigate({ step: "propose" });
	}
	useEscapeToCancel({
		enabled: draft !== null && !busy,
		onCancel: () => {
			void discardDraft();
		},
	});

	function beginDraft(source: SchemaRevisionResponse) {
		setError(null);
		setNotice(null);
		setDraft({
			input: schemaDocument(source.json_schema),
			enforce: source.validate_schema,
			base: source,
		});
		navigate({ step: "propose", view: "flow", task: null, rebuild: null });
	}

	const proposal = useMemo(() => {
		if (!checkedDraft)
			return {
				value: candidate
					? {
							json_schema: candidate.json_schema ?? null,
							validate_schema: candidate.validate_schema,
						}
					: null,
				error: null,
			};
		try {
			return {
				value: parseSchemaDraft(checkedDraft.input, checkedDraft.enforce),
				error: null,
			};
		} catch (cause) {
			return {
				value: null,
				error: cause instanceof Error ? cause.message : "Invalid schema.",
			};
		}
	}, [candidate, checkedDraft]);
	const changes = useMemo(
		() =>
			active && proposal.value
				? buildObjectDataPatchPlan(
						{
							json_schema: active.json_schema ?? null,
							validate_schema: active.validate_schema,
						},
						proposal.value,
					).changes
				: [],
		[active, proposal.value],
	);
	const activationBlock = workQuery.isError
		? "The impact report could not be refreshed. Reload it before activation."
		: schemaActivationBlock(
				candidate,
				active,
				summaryQuery.isError ? undefined : summaryQuery.data,
				matchingWork,
			);

	async function confirmActivation(policy: SchemaActivationPolicy) {
		setError(null);
		setNotice(null);
		const pending = policy === "allow_pending";
		if (
			!(await confirm({
				title: `Activate revision ${candidate?.revision}${pending ? " with pending validation" : ""}?`,
				description: pending
					? "This changes the active policy without proving existing objects compatible. Object JSON remains unchanged. Enforced objects become pending while background validation runs; subsequent writes must satisfy the new schema. Disabling enforcement makes validation not required."
					: "This changes the active policy and starts background revalidation. Existing object JSON remains unchanged. The server checks the active revision and compatibility again before committing.",
				confirmLabel: pending
					? "Activate with pending validation"
					: "Activate schema",
				...(pending ? { tone: "danger" as const } : {}),
			}))
		)
			return;
		activationMutation.mutate(policy);
	}

	if (classQuery.isPending || activeQuery.isPending)
		return <p role="status">Loading class schema…</p>;
	if (classQuery.isError || activeQuery.isError)
		return (
			<section className="card stack">
				<h1>Class schema</h1>
				<p role="alert" className="error-banner">
					{activeQuery.error instanceof SchemaApiError &&
					activeQuery.error.status === 404
						? "This server does not expose versioned schemas. Use the class page to edit its schema."
						: (classQuery.error?.message ?? activeQuery.error?.message)}
				</p>
				<Link href={`/classes/${classId}`}>Back to class</Link>
			</section>
		);
	return (
		<section className="stack schema-workspace">
			<header className="panel-header">
				<div>
					<h1>Schema · {classQuery.data?.name}</h1>
					<p className="muted">
						Propose a revision, review its effects, and activate when ready.
					</p>
				</div>
				{!draft ? (
					<Link className="link-chip" href={`/classes/${classId}`}>
						Back to class
					</Link>
				) : (
					<button
						type="button"
						className="ghost"
						disabled={busy}
						onClick={() => void discardDraft()}
					>
						Discard draft
					</button>
				)}
			</header>
			<article className="card stack">
				<div className="panel-header">
					<h2>Active revision {active?.revision}</h2>
					<span className="status-pill">
						Validation {active?.validate_schema ? "enforced" : "not enforced"}
					</span>
				</div>
				{canReadReports && summaryQuery.data ? (
					<div className="summary-grid">
						{Object.entries(summaryQuery.data.counts).map(([key, count]) => (
							<div className="summary-pill" key={key}>
								<span>{key.replaceAll("_", " ")}</span>
								<strong>{count}</strong>
							</div>
						))}
					</div>
				) : null}
				{summaryQuery.isError ? (
					<p className="error-banner" role="alert">
						Could not load administrator schema status.{" "}
						{summaryQuery.error.message}
					</p>
				) : null}
				{summaryQuery.isSuccess && !canReadReports ? (
					<p className="muted">
						Impact analysis, aggregate counts, and revalidation require
						unrestricted administrator access. Save a proposal and share its
						revision link with an administrator.
					</p>
				) : null}
				<div className="action-row">
					<button
						type="button"
						disabled={busy || draft !== null || !active}
						onClick={() => active && beginDraft(active)}
					>
						Propose change
					</button>
					<button
						type="button"
						className="ghost"
						disabled={busy || draft !== null}
						onClick={() => navigate({ view: "history" })}
					>
						Revision history
					</button>
					<button
						type="button"
						className="ghost"
						disabled={busy || draft !== null}
						onClick={() => navigate({ view: "compliance" })}
					>
						Object compliance
					</button>
					{canReadReports ? (
						<button
							type="button"
							className="ghost"
							disabled={
								busy || draft !== null || matchingWork?.status === "running"
							}
							onClick={() => {
								setError(null);
								startMutation.mutate("revalidation");
							}}
						>
							Revalidate active schema
						</button>
					) : null}
				</div>
			</article>
			{error ? (
				<p className="error-banner" role="alert">
					{error}
				</p>
			) : null}
			{notice ? (
				<p className="info-banner" role="status">
					{notice}
				</p>
			) : null}
			{view === "history" ? (
				<SchemaRevisionHistory classId={classId} />
			) : view === "compliance" ? (
				<SchemaCompliancePanel classId={classId} />
			) : (
				<>
					{revisionQuery.isError ? (
						<p className="error-banner" role="alert">
							{revisionQuery.error.message}
						</p>
					) : null}
					{candidate && !draft ? (
						<div className="panel-header">
							<h2>
								Revision {candidate.revision} · {candidate.status}
							</h2>
							<Link
								href={`/classes/${classId}/schema?revision=${candidate.revision}${taskId ? `&task=${taskId}&step=${step}` : ""}`}
							>
								Link to this revision{taskId ? " and report" : ""}
							</Link>
						</div>
					) : null}
					<GuidedFlowTabs<Step>
						activeStep={step}
						ariaLabel="Schema change steps"
						idPrefix="schema-flow"
						onChange={(next) => navigate({ step: next })}
						steps={[
							{
								id: "propose",
								label: "Propose",
								hint: "Define the schema and enforcement",
								enabled: !busy,
							},
							{
								id: "review",
								label: "Review changes",
								hint: "Compare with the active policy",
								enabled: !busy && !checkingDraft && proposal.value !== null,
							},
							{
								id: "impact",
								label: "Analyze impact",
								hint: "Check existing objects",
								enabled: !busy && !draft && !!candidate,
							},
							{
								id: "activate",
								label: "Activate",
								hint: "Apply the policy explicitly",
								enabled: !busy && !draft && !!candidate,
							},
						]}
					/>
					{step === "propose" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="propose">
							{draft ? (
								<>
									<div className="card stack">
										<h3>Unsaved proposal</h3>
										<p>
											Started from revision {draft.base.revision}. Saving
											creates an immutable revision and leaves the active policy
											unchanged.
										</p>
										{draft.base.revision !== active?.revision ? (
											<p className="info-banner">
												The starting revision differs from the current active
												schema. Review all changes before saving.
											</p>
										) : null}
										<label className="control-check">
											<input
												type="checkbox"
												checked={draft.enforce}
												disabled={busy}
												onChange={(event) =>
													setDraft({ ...draft, enforce: event.target.checked })
												}
											/>
											<span>Enforce validation on object writes</span>
										</label>
										<JsonEditor
											id="schema-proposal"
											disabled={busy}
											label="Proposed JSON schema"
											mode="schema"
											value={draft.input}
											onChange={(input) => setDraft({ ...draft, input })}
											rows={16}
											helperText="Leave empty and turn off enforcement to remove the schema. The server validates supported schema features and limits when you save."
										/>
										{proposal.error ? (
											<p role="status">{proposal.error}</p>
										) : null}
									</div>
									<GuidedFlowContinue
										title="Review your proposal"
										summary="Compare the complete policy before saving a revision."
										nextLabel="Review changes"
										disabled={busy || checkingDraft || !!proposal.error}
										onContinue={() => navigate({ step: "review" })}
									/>
								</>
							) : candidate ? (
								<div className="card stack">
									<p>
										Validation{" "}
										{candidate.validate_schema ? "enforced" : "not enforced"}.
										Saved schema revisions cannot be edited.
									</p>
									<pre className="schema-document">
										{schemaDocument(candidate.json_schema) ||
											"No schema document"}
									</pre>
									<div className="action-row">
										<button
											type="button"
											disabled={busy}
											onClick={() => beginDraft(candidate)}
										>
											{candidate.status === "staged"
												? "Revise proposal"
												: "Use as starting point"}
										</button>
										{candidate.status === "staged" ? (
											<button
												type="button"
												className="ghost"
												disabled={busy}
												onClick={async () => {
													if (
														await confirm({
															title: `Abandon revision ${candidate.revision}?`,
															description:
																"The revision stays in history and will not be activated.",
															confirmLabel: "Abandon revision",
															tone: "danger",
														})
													)
														abandonMutation.mutate();
												}}
											>
												Abandon revision
											</button>
										) : null}
									</div>
									<GuidedFlowContinue
										title="Inspect this revision"
										summary="Review its differences from the current active policy."
										nextLabel="Review changes"
										onContinue={() => navigate({ step: "review" })}
									/>
								</div>
							) : null}
						</GuidedFlowPanel>
					) : null}
					{step === "review" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="review">
							<article className="card stack">
								<h3>Changes from active revision {active?.revision}</h3>
								<p>
									Validation:{" "}
									{active?.validate_schema ? "enforced" : "not enforced"} →{" "}
									{proposal.value?.validate_schema
										? "enforced"
										: "not enforced"}
								</p>
								{changes.length === 0 ? (
									<p>No policy changes from the active revision.</p>
								) : (
									<ul>
										{changes.slice(0, 50).map((change) => (
											<li key={change.path}>
												<strong>{change.operation}</strong>{" "}
												<code>{change.path || "/"}</code>
												<div className="schema-change-values">
													<pre>
														{JSON.stringify(change.previousValue, null, 2) ??
															"(absent)"}
													</pre>
													<span>changes to</span>
													<pre>
														{JSON.stringify(change.nextValue, null, 2) ??
															"(absent)"}
													</pre>
												</div>
											</li>
										))}
									</ul>
								)}
								{changes.length > 50 ? (
									<p>
										{changes.length - 50} further changes. Inspect the complete
										document in the Propose step.
									</p>
								) : null}
								{draft ? (
									<button
										type="button"
										disabled={
											busy ||
											checkingDraft ||
											!!proposal.error ||
											changes.length === 0
										}
										onClick={() => {
											setError(null);
											stageMutation.mutate();
										}}
									>
										{stageMutation.isPending
											? "Saving revision…"
											: "Save revision"}
									</button>
								) : (
									<GuidedFlowContinue
										title="Assess the saved revision"
										summary="Analyze existing objects before deciding whether to activate."
										nextLabel="Analyze impact"
										onContinue={() => navigate({ step: "impact" })}
									/>
								)}
							</article>
						</GuidedFlowPanel>
					) : null}
					{step === "impact" || step === "activate" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId={step}>
							{workQuery.isPending && taskId && canReadReports ? (
								<p role="status">Loading schema report…</p>
							) : null}
							{workQuery.isError ? (
								<p role="alert" className="error-banner">
									{workQuery.error.message}
								</p>
							) : null}
							{work && !matchingWork ? (
								<p role="alert" className="error-banner">
									This task belongs to a different revision. Its findings cannot
									authorize this proposal.
								</p>
							) : null}
							{matchingWork ? <SchemaWorkReport work={matchingWork} /> : null}
							{matchingWork?.status === "running" && canReadReports ? (
								<button
									type="button"
									className="ghost"
									disabled={busy}
									onClick={async () => {
										if (
											await confirm({
												title: "Cancel schema work?",
												description:
													"Completed batches remain. Cancellation stops further results; it does not undo activation.",
												confirmLabel: "Cancel work",
												tone: "danger",
											})
										)
											cancelMutation.mutate();
									}}
								>
									Cancel work
								</button>
							) : null}
							{step === "impact" ? (
								<>
									<div className="card stack">
										<h3>Analyze this proposal</h3>
										<p>
											Checks the proposed and active policies against the same
											objects without changing their data or current compliance.
										</p>
										{canReadReports ? (
											<>
												<button
													type="button"
													disabled={
														busy ||
														draft !== null ||
														candidate?.status !== "staged" ||
														matchingWork?.status === "running"
													}
													onClick={() => {
														setError(null);
														startMutation.mutate("impact");
													}}
												>
													{matchingWork ? "Analyze again" : "Analyze impact"}
												</button>
												<form
													className="action-row"
													onSubmit={(event) => {
														event.preventDefault();
														const id = positiveSchemaId(reportInput);
														if (id) navigate({ task: id });
													}}
												>
													<label className="control-field">
														<span>Existing analysis task ID</span>
														<input
															type="number"
															min={1}
															step={1}
															value={reportInput}
															onChange={(event) =>
																setReportInput(event.target.value)
															}
														/>
													</label>
													<button
														type="submit"
														className="ghost"
														disabled={!positiveSchemaId(reportInput)}
													>
														Open report
													</button>
												</form>
											</>
										) : (
											<p>
												Share the saved revision link with an administrator to
												run and review its impact analysis.
											</p>
										)}
									</div>
									<GuidedFlowContinue
										title="Review activation"
										summary="A compatible report enables normal activation. An administrator can explicitly allow pending validation."
										nextLabel="Activate"
										disabled={!!draft}
										onContinue={() => navigate({ step: "activate" })}
									/>
								</>
							) : (
								<article className="card stack">
									<h3>
										{candidate?.status === "active"
											? "This revision is active"
											: "Activate this revision"}
									</h3>
									{candidate?.status === "active" ? (
										<>
											<p>
												New writes use this policy. Background validation
												records compliance without rewriting object JSON.
											</p>
											{rebuildId ? (
												<Link href={`/tasks/${rebuildId}`}>
													Follow computed-field rebuild #{rebuildId}
												</Link>
											) : null}
											<button
												type="button"
												className="ghost"
												onClick={() => navigate({ view: "compliance" })}
											>
												View object compliance
											</button>
										</>
									) : (
										<>
											<p>
												Activation replaces revision {active?.revision}.
												Existing object data remains unchanged.
											</p>
											{activationBlock ? (
												<p className="info-banner">{activationBlock}</p>
											) : null}
											<button
												type="button"
												disabled={
													busy ||
													!!draft ||
													!!activationBlock ||
													activeQuery.isFetching ||
													summaryQuery.isFetching ||
													revisionQuery.isFetching ||
													workQuery.isFetching
												}
												onClick={() =>
													void confirmActivation("reject_incompatible")
												}
											>
												Activate after compatibility checks
											</button>
											{canReadReports && candidate?.status === "staged" ? (
												<details>
													<summary>Administrator activation option</summary>
													<div className="stack">
														<p>
															Allow activation without compatible impact proof.
															Enforced objects become pending until
															revalidation; some may fail the new policy.
														</p>
														<button
															type="button"
															className="danger"
															disabled={busy || !!draft || !active}
															onClick={() =>
																void confirmActivation("allow_pending")
															}
														>
															Activate with pending validation…
														</button>
													</div>
												</details>
											) : null}
										</>
									)}
								</article>
							)}
						</GuidedFlowPanel>
					) : null}
				</>
			)}
		</section>
	);
}
