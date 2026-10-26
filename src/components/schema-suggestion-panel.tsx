"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useId, useState } from "react";
import { TaskCancellation } from "@/components/task-cancellation";
import type { ProfilePreset } from "@/lib/api/generated/models";
import {
	fetchSchemaProfile,
	submitSchemaProfile,
} from "@/lib/api/schema-profiling";
import { fetchTask, isTerminalTaskStatus } from "@/lib/api/tasking";
import {
	SCHEMA_PROFILE_PRESETS,
	schemaSuggestionError,
	schemaSuggestionFinding,
	usableSchemaSuggestion,
} from "@/lib/schema-suggestion";

type Props = {
	classId: number;
	taskId: number | null;
	disabled?: boolean;
	onTask: (taskId: number) => void;
	onUseCandidate: (schema: unknown) => Promise<void>;
};

export function SchemaSuggestionPanel({
	classId,
	taskId,
	disabled,
	onTask,
	onUseCandidate,
}: Props) {
	const id = useId();
	const queryClient = useQueryClient();
	const [preset, setPreset] = useState<ProfilePreset>("balanced");
	const [limit, setLimit] = useState("100");
	const [applying, setApplying] = useState(false);
	const [applyError, setApplyError] = useState<string | null>(null);
	const sampleLimit = Number(limit);
	const validLimit =
		/^\d+$/.test(limit) &&
		Number.isSafeInteger(sampleLimit) &&
		sampleLimit >= 1 &&
		sampleLimit <= 250;
	const task = useQuery({
		queryKey: ["task", taskId],
		queryFn: () => fetchTask(taskId as number),
		enabled: taskId !== null,
		retry: false,
		refetchInterval: (query) =>
			query.state.status === "error" ||
			isTerminalTaskStatus(query.state.data?.status)
				? false
				: 2000,
	});
	const matchesClass =
		task.data?.kind === "schema_profiling" &&
		task.data.details?.schema_profiling?.class_id === classId;
	const report = useQuery({
		queryKey: ["schema-profile", classId, taskId],
		queryFn: ({ signal }) =>
			fetchSchemaProfile(classId, taskId as number, signal),
		enabled:
			taskId !== null && matchesClass && task.data?.status === "succeeded",
		retry: false,
		gcTime: 0,
	});
	const submit = useMutation({
		mutationFn: () =>
			submitSchemaProfile(classId, { preset, sample_limit: sampleLimit }),
		onSuccess: (result) => {
			queryClient.setQueryData(["task", result.id], result);
			void queryClient.invalidateQueries({ queryKey: ["tasks"] });
			onTask(result.id);
			setApplyError(null);
		},
	});
	const running = task.data && !isTerminalTaskStatus(task.data.status);
	const unavailable =
		task.data &&
		isTerminalTaskStatus(task.data.status) &&
		task.data.status !== "succeeded";
	const error = submit.error ?? task.error ?? report.error;
	const reportPreset =
		SCHEMA_PROFILE_PRESETS.find(
			(option) => option.value === (report.data?.options.preset ?? "balanced"),
		)?.label ?? "Unknown";
	return (
		<section className="card stack" aria-labelledby={`${id}-title`}>
			<div>
				<h2 id={`${id}-title`}>Suggest a schema from existing objects</h2>
				<p className="muted">
					Start with an authorized sample, review the suggested schema, then
					check all existing objects before activation.
				</p>
			</div>
			<form
				className="stack"
				onSubmit={(event) => {
					event.preventDefault();
					if (validLimit && !running && !submit.isPending && !disabled)
						submit.mutate();
				}}
			>
				<div className="action-row">
					<label className="control-field">
						<span>
							{taskId ? "Preset for a new suggestion" : "Suggestion preset"}
						</span>
						<select
							value={preset}
							onChange={(event) =>
								setPreset(event.target.value as ProfilePreset)
							}
							disabled={submit.isPending || Boolean(running)}
						>
							{SCHEMA_PROFILE_PRESETS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="control-field">
						<span>Maximum sampled objects</span>
						<input
							type="number"
							min={1}
							max={250}
							step={1}
							required
							value={limit}
							onChange={(event) => setLimit(event.target.value)}
							disabled={submit.isPending || Boolean(running)}
							aria-describedby={`${id}-sample`}
						/>
					</label>
					<button
						type="submit"
						disabled={
							!validLimit || submit.isPending || Boolean(running) || disabled
						}
					>
						{submit.isPending
							? "Starting suggestion…"
							: running
								? "Generating suggestion…"
								: taskId
									? "Generate new suggestion"
									: "Generate suggestion"}
					</button>
				</div>
				<p className="muted" id={`${id}-sample`}>
					{
						SCHEMA_PROFILE_PRESETS.find((option) => option.value === preset)
							?.description
					}{" "}
					Sample between 1 and 250 objects. Reports expire after 24 hours.
				</p>
			</form>
			{error ? (
				<p role="alert" className="error-banner">
					{schemaSuggestionError(error)}
				</p>
			) : null}
			{taskId ? (
				<p role="status">
					Suggestion task <Link href={`/tasks/${taskId}`}>#{taskId}</Link>
					{task.data
						? ` · ${task.data.status.replaceAll("_", " ")}`
						: " · loading…"}
				</p>
			) : null}
			{task.data && !matchesClass ? (
				<p role="alert" className="error-banner">
					This task does not describe a schema suggestion for this class.
				</p>
			) : null}
			{running && matchesClass && task.data ? (
				<TaskCancellation task={task.data} />
			) : null}
			{unavailable ? (
				<p className="info-banner">
					This task produced no suggestion. Inspect its task details or generate
					a new suggestion. The active schema is unchanged.
				</p>
			) : null}
			{report.isFetching ? (
				<p role="status">Loading suggestion report…</p>
			) : null}
			{report.data && report.isSuccess && task.isSuccess && matchesClass ? (
				<div className="stack">
					<h3>Suggestion result · {reportPreset} preset</h3>
					<p className="info-banner">
						Reviewed {report.data.sampled_objects} authorized objects with a
						limit of {report.data.effective_sample_limit}.{" "}
						{report.data.truncation
							? `The sample was limited (${report.data.truncation.replaceAll("_", " ")}). `
							: ""}
						A passing sample does not prove whole-class compatibility.
					</p>
					{report.data.status === "blocked" ? (
						<p role="status">
							This suggestion's inference policy found conflicting evidence.
							Review the findings or try Balanced or Expansive.
						</p>
					) : null}
					{report.data.status === "insufficient" ? (
						<p role="status">
							No usable authorized sample was available. Add objects or check
							access, then generate another suggestion.
						</p>
					) : null}
					{report.data.schema != null ? (
						<details open>
							<summary>Suggested JSON Schema</summary>
							<pre className="json-preview">
								{JSON.stringify(report.data.schema, null, 2)}
							</pre>
						</details>
					) : null}
					{report.data.findings.length ? (
						<details>
							<summary>
								Inference findings ({report.data.findings.length})
							</summary>
							<ul>
								{report.data.findings.map((finding) => {
									const detail = schemaSuggestionFinding(finding);
									return (
										<li key={JSON.stringify(finding)}>
											{detail.path ? (
												<>
													<code>{detail.path}</code>
													{": "}
												</>
											) : null}
											{detail.message}
										</li>
									);
								})}
							</ul>
							<details>
								<summary>Full finding details</summary>
								<pre className="json-preview">
									{JSON.stringify(report.data.findings, null, 2)}
								</pre>
							</details>
						</details>
					) : null}
					{usableSchemaSuggestion(report.data, classId) ? (
						<button
							type="button"
							disabled={
								disabled || applying || submit.isPending || report.isFetching
							}
							onClick={async () => {
								setApplying(true);
								setApplyError(null);
								try {
									await onUseCandidate(report.data.schema);
								} catch (cause) {
									setApplyError(schemaSuggestionError(cause));
								} finally {
									setApplying(false);
								}
							}}
						>
							{applying ? "Preparing proposal…" : "Use suggestion in proposal"}
						</button>
					) : null}
					{applyError ? (
						<p role="alert" className="error-banner">
							{applyError}
						</p>
					) : null}
					<p className="muted">
						Using a suggestion fills the proposal editor. Review validation
						settings, check existing objects, and activate explicitly.
					</p>
				</div>
			) : null}
		</section>
	);
}
