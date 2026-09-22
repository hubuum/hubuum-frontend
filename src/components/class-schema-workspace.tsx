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
	SchemaWorkResponse,
} from "@/lib/api/generated/models";
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
	type SchemaFlowStep,
	sameSchemaPolicy,
	schemaActivationBlock,
	schemaActivationLabel,
	schemaDocument,
	schemaFlowStep,
	schemaTestPolicy,
	summarizeSchemaChanges,
} from "@/lib/schema-evolution";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

const JsonEditor = dynamic(
	() => import("@/components/json-editor").then((module) => module.JsonEditor),
	{
		loading: () => <p role="status">Loading editor…</p>,
	},
);
type Draft = { input: string; enforce: boolean; base: SchemaRevisionResponse };
function draftFrom(revision: SchemaRevisionResponse): Draft {
	return {
		input: schemaDocument(revision.json_schema),
		enforce: revision.validate_schema,
		base: revision,
	};
}
function useSchemaWork(
	classId: number,
	taskId: number | null,
	enabled: boolean,
) {
	return useQuery({
		queryKey: ["schema", classId, "work", taskId],
		queryFn: ({ signal }) => fetchSchemaWork(classId, taskId as number, signal),
		enabled: taskId !== null && enabled,
		retry: false,
		refetchInterval: (query) =>
			query.state.status === "error"
				? false
				: query.state.data?.status === "running"
					? 2000
					: query.state.data?.kind === "impact"
						? 10000
						: false,
	});
}

export function ClassSchemaWorkspace({ classId }: { classId: number }) {
	const router = useRouter();
	const params = useSearchParams();
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const revisionId = positiveSchemaId(params.get("revision"));
	const taskId = positiveSchemaId(params.get("task"));
	const checkId = positiveSchemaId(params.get("check"));
	const checkRevision = positiveSchemaId(params.get("check_revision"));
	const step = schemaFlowStep(params.get("step"));
	const view = params.get("view") ?? "flow";
	const [editedDraft, setDraft] = useState<Draft | null>(null);
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
	const draft = useMemo(
		() => editedDraft ?? (candidate ? draftFrom(candidate) : null),
		[editedDraft, candidate],
	);
	const checkedDraft = useDebouncedValue(draft, 250);
	const checkingDraft = draft !== checkedDraft;
	const proposal = useMemo(() => {
		try {
			return {
				value: checkedDraft
					? parseSchemaDraft(checkedDraft.input, checkedDraft.enforce)
					: null,
				error: null,
			};
		} catch (cause) {
			return {
				value: null,
				error: cause instanceof Error ? cause.message : "Invalid schema.",
			};
		}
	}, [checkedDraft]);
	const dirty = useMemo(() => {
		if (!editedDraft) return false;
		try {
			return !sameSchemaPolicy(
				parseSchemaDraft(editedDraft.input, editedDraft.enforce),
				editedDraft.base,
			);
		} catch {
			return true;
		}
	}, [editedDraft]);
	// Successful summary access establishes administrator access, including token scope.
	const canReadReports = summaryQuery.isSuccess && summaryQuery.data !== null;
	const workQuery = useSchemaWork(classId, taskId, canReadReports);
	const checkQuery = useSchemaWork(classId, checkId, canReadReports);
	const work = workQuery.data;
	const matchingWork =
		work?.target.class_id === classId &&
		work.target.revision === candidate?.revision
			? work
			: undefined;
	const checkPolicyQuery = useQuery({
		queryKey: ["schema", classId, "revision", checkRevision],
		queryFn: ({ signal }) =>
			fetchSchemaRevision(classId, checkRevision as number, signal),
		enabled: checkRevision !== null && checkId !== null && canReadReports,
		retry: false,
	});
	const expectedTestPolicy = candidate ? schemaTestPolicy(candidate) : null;
	const testWork =
		checkQuery.data?.target.class_id === classId &&
		checkQuery.data.target.revision === checkRevision &&
		checkQuery.data.kind === "impact" &&
		checkPolicyQuery.data &&
		expectedTestPolicy &&
		sameSchemaPolicy(checkPolicyQuery.data, expectedTestPolicy)
			? checkQuery.data
			: undefined;
	const needsSeparateTest = !!expectedTestPolicy && view !== "report";
	const displayedWork = needsSeparateTest ? testWork : matchingWork;
	const analysisRunning =
		matchingWork?.status === "running" || testWork?.status === "running";

	function navigate(values: Record<string, string | number | null>) {
		const next = new URLSearchParams(params);
		for (const [key, value] of Object.entries(values)) {
			if (value === null) next.delete(key);
			else next.set(key, String(value));
		}
		router.replace(`/classes/${classId}/schema?${next}`, { scroll: false });
	}
	function cacheWork(result: SchemaWorkResponse) {
		queryClient.setQueryData(
			["schema", classId, "work", result.task_id],
			result,
		);
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
		if (!dirty) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [dirty]);
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
	async function saveProposal() {
		if (!draft) throw new Error("Wait for the schema to load.");
		const policy = parseSchemaDraft(draft.input, draft.enforce);
		if (
			candidate &&
			sameSchemaPolicy(policy, candidate) &&
			["active", "staged"].includes(candidate.status)
		)
			return candidate;
		const saved = await stageSchema(classId, policy);
		queryClient.setQueryData(
			["schema", classId, "revision", saved.revision],
			saved,
		);
		setDraft(null);
		setNotice(
			saved.status === "active"
				? "This policy is already active. No new revision was needed."
				: `Revision ${saved.revision} is saved. The active schema has not changed.`,
		);
		navigate({
			revision: saved.revision,
			task: null,
			check: null,
			check_revision: null,
			rebuild: null,
		});
		return saved;
	}
	const stageMutation = useMutation({
		mutationFn: saveProposal,
		onSuccess: async (saved) => {
			navigate({
				revision: saved.revision,
				task: null,
				check: null,
				check_revision: null,
				step: "review",
			});
			await refreshSchema();
		},
		onError,
	});
	const checkMutation = useMutation({
		mutationFn: async () => {
			const saved = await saveProposal();
			const result = await startSchemaWork(classId, saved.revision, "impact");
			cacheWork(result);
			const route = {
				revision: saved.revision,
				task: result.task_id,
				check: null,
				check_revision: null,
			};
			navigate(route);
			// An unenforced policy reports "not required". Test an enforced snapshot
			// separately, while retaining the exact selected policy and its activation proof.
			const testPolicy = schemaTestPolicy(saved);
			if (testPolicy) {
				const snapshot = await stageSchema(classId, testPolicy);
				const check = await startSchemaWork(
					classId,
					snapshot.revision,
					"impact",
				);
				cacheWork(check);
				navigate({
					...route,
					check: check.task_id,
					check_revision: snapshot.revision,
				});
			}
		},
		onSuccess: refreshSchema,
		onError,
	});
	const activationMutation = useMutation({
		mutationFn: async (policy: SchemaActivationPolicy) => {
			if (!candidate || !active || dirty || checkingDraft)
				throw new Error("Save and review a revision first.");
			if (policy === "reject_incompatible") {
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
			setDraft(null);
			await refreshSchema();
			const next = new URLSearchParams();
			if (result.task_id) next.set("schema_task", String(result.task_id));
			if (result.dependent_rebuild_task_id)
				next.set("schema_rebuild", String(result.dependent_rebuild_task_id));
			router.push(`/classes/${classId}?${next}`);
		},
		onError,
	});
	const abandonMutation = useMutation({
		mutationFn: () => abandonSchema(classId, candidate?.revision as number),
		onSuccess: async () => {
			setDraft(null);
			setNotice("The staged revision was abandoned.");
			navigate({ view: "revision" });
			await refreshSchema();
		},
		onError,
	});
	const cancelMutation = useMutation({
		mutationFn: async () => {
			const running = [matchingWork, testWork].filter(
				(item) => item?.status === "running",
			);
			for (const item of running)
				if (item) cacheWork(await cancelSchemaWork(classId, item.task_id));
		},
		onSuccess: async () => {
			setNotice("Work cancelled. Completed batches are retained.");
			await refreshSchema();
		},
		onError: (cause) => {
			onError(cause);
			void refreshSchema();
		},
	});
	const busy =
		stageMutation.isPending ||
		checkMutation.isPending ||
		activationMutation.isPending ||
		abandonMutation.isPending ||
		cancelMutation.isPending;
	async function leaveEditor() {
		if (
			dirty &&
			!(await confirm({
				title: "Discard this unsaved proposal?",
				description: "The draft has not been saved as a revision.",
				confirmLabel: "Discard draft",
				tone: "danger",
			}))
		)
			return;
		setDraft(null);
		router.push(`/classes/${classId}`);
	}
	useEscapeToCancel({
		enabled: dirty && !busy,
		onCancel: () => {
			void leaveEditor();
		},
	});
	function beginDraft(source: SchemaRevisionResponse) {
		setError(null);
		setNotice(null);
		setDraft(draftFrom(source));
		navigate({ step: "schema", view: "flow" });
	}
	const review = useMemo(
		() =>
			active && proposal.value
				? summarizeSchemaChanges(active, proposal.value)
				: null,
		[active, proposal.value],
	);
	const activationBlock = dirty
		? "The proposal has changed. Check it again before activation."
		: workQuery.isError
			? "The impact report could not be refreshed. Reload it before activation."
			: schemaActivationBlock(
					candidate,
					active,
					summaryQuery.isError ? undefined : summaryQuery.data,
					matchingWork,
				);
	const activationDisabled =
		busy ||
		checkingDraft ||
		activationBlock !== null ||
		activeQuery.isFetching ||
		summaryQuery.isFetching ||
		revisionQuery.isFetching ||
		workQuery.isFetching;
	const analysisDisabled =
		busy || checkingDraft || !!proposal.error || !candidate || analysisRunning;
	const activationLabel = schemaActivationLabel(
		active,
		proposal.value ?? undefined,
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
					: candidate?.validate_schema
						? "New and edited objects must match this schema. Background validation checks existing objects without changing their JSON. The server checks compatibility again before committing."
						: "Object writes will not be required to match a schema. Existing object JSON remains unchanged; live compliance becomes not required.",
				confirmLabel: pending
					? "Activate with pending validation"
					: activationLabel,
				...(pending ? { tone: "danger" as const } : {}),
			}))
		)
			return;
		activationMutation.mutate(policy);
	}
	const administratorActivation =
		canReadReports && candidate?.status === "staged" ? (
			<details className="card stack">
				<summary>Override compatibility checks (administrator)</summary>
				<div className="stack">
					<p>
						Activate even if objects fail validation or analysis is incomplete.
						Existing objects stay unchanged and may remain invalid. New writes
						must satisfy the new policy.
					</p>
					<button
						type="button"
						className="danger"
						disabled={busy || dirty || checkingDraft || !active}
						onClick={() => void confirmActivation("allow_pending")}
					>
						Activate with pending validation…
					</button>
				</div>
			</details>
		) : null;
	const checkActions = (
		<div className="stack">
			{canReadReports ? (
				<div className="action-row">
					{view !== "report" ? (
						<button
							type="button"
							disabled={analysisDisabled}
							onClick={() => {
								setError(null);
								setNotice(null);
								checkMutation.mutate();
							}}
						>
							{checkMutation.isPending
								? "Starting check…"
								: analysisRunning
									? "Check in progress…"
									: displayedWork && !dirty
										? "Check again"
										: "Check existing objects"}
						</button>
					) : null}
					{analysisRunning ? (
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
				</div>
			) : (
				<p>
					Class-wide checks require unrestricted administrator access. Save the
					proposal and share its revision link with an administrator.
				</p>
			)}
			{dirty && (taskId || checkId) ? (
				<p className="info-banner">
					These results are for the saved proposal. Check again to test your
					changes.
				</p>
			) : null}
			{workQuery.isPending && taskId && canReadReports ? (
				<p role="status">Loading schema report…</p>
			) : null}
			{workQuery.isError ? (
				<p role="alert" className="error-banner">
					{workQuery.error.message}
				</p>
			) : null}
			{checkPolicyQuery.isError ? (
				<p role="alert" className="error-banner">
					Could not verify the schema used for this test.{" "}
					{checkPolicyQuery.error.message}
				</p>
			) : null}
			{checkQuery.isError ? (
				<p role="alert" className="error-banner">
					The schema test could not be loaded. {checkQuery.error.message}
				</p>
			) : null}
			{work && !matchingWork ? (
				<p role="alert" className="error-banner">
					This task belongs to a different revision. Its findings cannot
					authorize this proposal.
				</p>
			) : null}
			{checkQuery.data && checkPolicyQuery.isSuccess && !testWork ? (
				<p role="alert" className="error-banner">
					This schema test belongs to a different revision.
				</p>
			) : null}
		</div>
	);
	const changeSummary = (
		<article className="card stack" aria-label="Proposed changes">
			<h3>What will change</h3>
			{review ? (
				review.schema === "unchanged" && review.enforcement === "unchanged" ? (
					<p>No changes to activate.</p>
				) : (
					<>
						<div>
							<strong>
								{review.enforcement === "enabled"
									? "Enable schema validation"
									: review.enforcement === "disabled"
										? "Turn off schema validation"
										: proposal.value?.validate_schema
											? "Keep schema validation enabled"
											: "Keep schema validation off"}
							</strong>
							<p>
								{proposal.value?.validate_schema
									? "New and edited objects must match the schema. Existing objects will be checked in the background."
									: "Objects can be saved without matching a schema."}
							</p>
						</div>
						<p>
							{
								{
									unchanged: "The schema itself is unchanged.",
									added: "Add the proposed schema.",
									removed: "Remove the current schema.",
									updated:
										"Replace the current schema with the proposed version.",
								}[review.schema]
							}
						</p>
						{review.documentChanges.length > 0 ? (
							<details className="stack">
								<summary>View schema changes</summary>
								<p className="muted">
									Compared with active revision {active?.revision}.
								</p>
								<ul>
									{review.documentChanges.slice(0, 50).map((change) => (
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
								{review.documentChanges.length > 50 ? (
									<p>
										{review.documentChanges.length - 50} further changes.
										Inspect the complete document in the Schema step.
									</p>
								) : null}
							</details>
						) : null}
					</>
				)
			) : null}
			{dirty ||
			candidate?.status === "retired" ||
			candidate?.status === "abandoned" ? (
				<button
					type="button"
					disabled={busy || checkingDraft || !!proposal.error}
					onClick={() => {
						setError(null);
						stageMutation.mutate();
					}}
				>
					{stageMutation.isPending ? "Saving revision…" : "Save revision"}
				</button>
			) : null}
		</article>
	);
	const testExplanation = checkId ? (
		<p className="info-banner">
			Schema test only: these findings show whether objects match the schema.
			Your proposed enforcement remains off. Activation uses a separate check of
			that setting.
		</p>
	) : null;

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
					<h1>
						{view === "flow" ? "Edit schema" : "Schema"} ·{" "}
						{classQuery.data?.name}
					</h1>
					<p className="muted">
						{view === "flow"
							? "Prepare and test a change. The current setup stays active until you activate."
							: "Saved revisions and validation results."}
					</p>
				</div>
				{dirty ? (
					<button
						type="button"
						className="ghost"
						disabled={busy}
						onClick={() => void leaveEditor()}
					>
						Discard draft
					</button>
				) : (
					<Link className="link-chip" href={`/classes/${classId}`}>
						Back to class
					</Link>
				)}
			</header>
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
			{summaryQuery.isError ? (
				<p className="error-banner" role="alert">
					Could not load administrator schema status.{" "}
					{summaryQuery.error.message}
				</p>
			) : null}
			{revisionQuery.isError ? (
				<p className="error-banner" role="alert">
					{revisionQuery.error.message}
				</p>
			) : null}
			{view === "history" ? (
				<SchemaRevisionHistory classId={classId} />
			) : view === "compliance" ? (
				<SchemaCompliancePanel classId={classId} />
			) : view === "report" ? (
				<>
					{checkActions}
					{matchingWork ? (
						<SchemaWorkReport key={matchingWork.task_id} work={matchingWork} />
					) : null}
				</>
			) : view === "revision" ? (
				candidate ? (
					<article className="card stack">
						<h2>
							Revision {candidate.revision} · {candidate.status}
						</h2>
						<p>
							Enforcement on writes: {candidate.validate_schema ? "On" : "Off"}
						</p>
						<pre className="schema-document">
							{schemaDocument(candidate.json_schema) || "No schema document"}
						</pre>
						<button type="button" onClick={() => beginDraft(candidate)}>
							Edit as a new proposal
						</button>
					</article>
				) : null
			) : (
				<>
					<div className="panel-header">
						<p className="muted">
							{dirty
								? "Unsaved proposal"
								: candidate?.status === "staged"
									? `Saved proposal · Revision ${candidate.revision}`
									: `Starting from revision ${candidate?.revision ?? "…"}`}
						</p>
						{candidate?.status === "staged" && !dirty ? (
							<Link href={`/classes/${classId}/schema?${params}`}>
								Link to this revision{taskId ? " and report" : ""}
							</Link>
						) : null}
					</div>
					<GuidedFlowTabs<SchemaFlowStep>
						activeStep={step}
						ariaLabel="Schema change steps"
						idPrefix="schema-flow"
						onChange={(next) => navigate({ step: next })}
						steps={[
							{
								id: "schema",
								label: "Schema",
								hint: "Edit the document",
								enabled: !busy,
							},
							{
								id: "validation",
								label: "Validation",
								hint: "Choose enforcement and try it",
								enabled: !busy && !!candidate,
							},
							{
								id: "review",
								label: "Review & test",
								hint: "Review changes and findings",
								enabled: !busy && !checkingDraft && !!proposal.value,
							},
							{
								id: "activate",
								label: "Activate",
								hint: "Apply the change",
								disabledHint: "Complete compatible analysis first",
								enabled:
									!activationDisabled ||
									(!busy && !dirty && candidate?.status === "active"),
							},
						]}
					/>
					{step === "schema" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="schema">
							{draft ? (
								<article className="card stack">
									<h2>Proposed schema</h2>
									<p>
										Define the shape of object data. Choose whether to enforce
										it in Validation.
									</p>
									<JsonEditor
										id="schema-proposal"
										disabled={busy}
										label="Proposed JSON schema"
										mode="schema"
										value={draft.input}
										onChange={(input) => setDraft({ ...draft, input })}
										rows={16}
										helperText="Leave empty to remove the schema, then turn off enforcement in Validation. The server checks supported schema features and limits when you save or check."
									/>
									{proposal.error ? (
										<p role="status">{proposal.error}</p>
									) : null}
								</article>
							) : null}
							<GuidedFlowContinue
								title="Set up validation"
								summary="Decide whether object writes must match this schema, and try it against existing objects."
								nextLabel="Validation"
								disabled={busy || !draft}
								onContinue={() => navigate({ step: "validation" })}
							/>
						</GuidedFlowPanel>
					) : null}
					{step === "validation" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="validation">
							<article className="card stack">
								<h2>Validation setup</h2>
								{draft ? (
									<label className="control-check">
										<input
											type="checkbox"
											checked={draft.enforce}
											disabled={busy || (!draft.enforce && !draft.input.trim())}
											onChange={(event) =>
												setDraft({ ...draft, enforce: event.target.checked })
											}
										/>
										<span>Enforce validation on object writes</span>
									</label>
								) : null}
								<p>
									{draft?.enforce
										? "After activation, new and edited objects must match the schema. Existing objects are checked in the background."
										: "After activation, objects can be saved without matching the schema. You can still test the schema below."}
								</p>
								{proposal.error ? <p role="status">{proposal.error}</p> : null}
							</article>
							<article className="card stack">
								<h3>Try it on existing objects</h3>
								<p>
									This runs a real check against saved objects. It saves your
									proposal and leaves the active setup and object data
									unchanged.
								</p>
								{proposal.value?.json_schema == null ? (
									<p>
										No schema is configured. This check evaluates the proposed
										setup; it cannot test objects against a schema.
									</p>
								) : null}
								{checkActions}
								{testExplanation}
								{displayedWork ? (
									<div className="stack" role="status">
										<strong>Check {displayedWork.status}</strong>
										<p>
											{displayedWork.examined} objects examined ·{" "}
											{displayedWork.valid} valid · {displayedWork.invalid}{" "}
											invalid · {displayedWork.not_required} not required ·{" "}
											{displayedWork.uninspectable} unassessed
										</p>
										<button
											type="button"
											className="ghost"
											onClick={() => navigate({ step: "review" })}
										>
											View findings
										</button>
									</div>
								) : null}
							</article>
							<GuidedFlowContinue
								title="Review the change"
								summary="Compare the proposal with the current setup and review the check results before activation."
								nextLabel="Review & test"
								disabled={busy || checkingDraft || !!proposal.error}
								onContinue={() => navigate({ step: "review" })}
							/>
						</GuidedFlowPanel>
					) : null}
					{step === "review" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="review">
							{changeSummary}
							<article className="card stack">
								<h3>Check existing objects</h3>
								<p>
									Test the proposal without changing object data or live
									compliance. Review any validation failures below.
								</p>
								{checkActions}
								{canReadReports ? (
									<details>
										<summary>Open an existing analysis</summary>
										<form
											className="action-row"
											onSubmit={(event) => {
												event.preventDefault();
												const id = positiveSchemaId(reportInput);
												if (id)
													navigate({
														task: id,
														check: null,
														check_revision: null,
													});
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
												disabled={!positiveSchemaId(reportInput) || busy}
											>
												Open report
											</button>
										</form>
									</details>
								) : null}
							</article>
							{testExplanation}
							{displayedWork ? (
								<SchemaWorkReport
									key={displayedWork.task_id}
									work={displayedWork}
								/>
							) : null}
							{needsSeparateTest && matchingWork ? (
								<details>
									<summary>Activation impact with enforcement off</summary>
									<SchemaWorkReport
										key={matchingWork.task_id}
										work={matchingWork}
									/>
								</details>
							) : null}
							{candidate?.status === "staged" || dirty ? (
								<>
									<GuidedFlowContinue
										title={
											analysisRunning
												? "Checking existing objects"
												: activationBlock
													? "Activation blocked"
													: "Ready to activate"
										}
										summary={
											activationBlock ??
											"The selected policy is ready. Review and confirm activation next."
										}
										nextLabel="Review activation"
										disabled={activationDisabled}
										onContinue={() => navigate({ step: "activate" })}
										backLabel="Revise proposal"
										onBack={
											!busy ? () => navigate({ step: "schema" }) : undefined
										}
									/>
									{administratorActivation}
								</>
							) : (
								<p>No policy change is waiting for activation.</p>
							)}
							{candidate?.status === "staged" && !dirty ? (
								<button
									type="button"
									className="ghost"
									disabled={busy || analysisRunning}
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
						</GuidedFlowPanel>
					) : null}
					{step === "activate" ? (
						<GuidedFlowPanel idPrefix="schema-flow" stepId="activate">
							<article className="card stack">
								<h2>
									{candidate?.status === "active"
										? "This revision is active"
										: "Activate this change"}
								</h2>
								<p>
									Enforcement on writes:{" "}
									{active?.validate_schema ? "On" : "Off"} →{" "}
									{proposal.value?.validate_schema ? "On" : "Off"}
								</p>
								<p>
									{proposal.value?.validate_schema
										? "New and edited objects must match the schema. Background validation will check existing objects and record their compliance."
										: "Object writes will not be required to match a schema. Live compliance will be not required, even if the schema test found mismatches."}{" "}
									Existing object data remains unchanged.
								</p>
								{candidate?.status !== "active" ? (
									<>
										<p>
											Activation replaces revision {active?.revision} with
											revision {candidate?.revision}.
										</p>
										{activationBlock ? (
											<p className="info-banner">{activationBlock}</p>
										) : null}
										<button
											type="button"
											disabled={activationDisabled}
											onClick={() =>
												void confirmActivation("reject_incompatible")
											}
										>
											{activationLabel}
										</button>
									</>
								) : (
									<Link href={`/classes/${classId}`}>
										View current schema &amp; validation
									</Link>
								)}
								<button
									type="button"
									className="ghost"
									disabled={busy}
									onClick={() => navigate({ step: "review" })}
								>
									Return to review &amp; test
								</button>
							</article>
							{administratorActivation}
						</GuidedFlowPanel>
					) : null}
				</>
			)}
		</section>
	);
}
