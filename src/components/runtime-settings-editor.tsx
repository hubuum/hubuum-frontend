"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
	fetchRuntimeSettingsCatalogue,
	fetchRuntimeSettingsGroup,
	type RuntimeSettingsDescriptor,
	type RuntimeSettingsState,
	runtimeChanges,
	runtimeFields,
	saveRuntimeSettings,
} from "@/lib/api/runtime-settings";

export function RuntimeSettingsEditor() {
	const catalogue = useQuery({
		queryKey: ["runtime-settings-catalogue"],
		queryFn: fetchRuntimeSettingsCatalogue,
		retry: false,
	});
	if (catalogue.isPending)
		return <p role="status">Loading supported runtime settings…</p>;
	if (catalogue.error)
		return (
			<p className="error-banner" role="alert">
				{catalogue.error.message}
			</p>
		);
	if (!catalogue.data)
		return (
			<p className="muted">
				This server does not advertise editable runtime settings. Effective
				configuration is shown below.
			</p>
		);
	const supported = catalogue.data.schema_version === 1;
	return (
		<section
			className="stack runtime-settings-editor"
			aria-label="Editable runtime settings"
		>
			{!supported && (
				<p className="error-banner">
					This settings catalogue requires a newer frontend. Settings are
					read-only.
				</p>
			)}
			{catalogue.data.groups.map((descriptor) => (
				<SettingsGroup
					key={descriptor.key}
					descriptor={descriptor}
					supported={supported}
				/>
			))}
		</section>
	);
}

function SettingsGroup({
	descriptor,
	supported,
}: {
	descriptor: RuntimeSettingsDescriptor;
	supported: boolean;
}) {
	const state = useQuery({
		queryKey: ["runtime-settings", descriptor.key],
		queryFn: () => fetchRuntimeSettingsGroup(descriptor.key),
		retry: false,
	});
	const [notice, setNotice] = useState("");
	return (
		<article className="card stack">
			<h3>{descriptor.title}</h3>
			<p className="muted">{descriptor.description}</p>
			{state.isPending && <p role="status">Loading settings…</p>}
			{state.error && (
				<p className="error-banner" role="alert">
					{state.error.message}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{state.data && (
				<SettingsForm
					key={`${descriptor.key}-${state.data.revision}`}
					descriptor={descriptor}
					state={state.data}
					supported={supported}
					onReload={() => {
						void state.refetch();
					}}
					onSaved={(message) => {
						setNotice(message);
						void state.refetch();
					}}
				/>
			)}
		</article>
	);
}

function SettingsForm({
	descriptor,
	state,
	supported,
	onReload,
	onSaved,
}: {
	descriptor: RuntimeSettingsDescriptor;
	state: RuntimeSettingsState;
	supported: boolean;
	onReload: () => void;
	onSaved: (message: string) => void;
}) {
	const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const initial = state.runtime ?? state.effective;
	const editable =
		supported &&
		descriptor.patch_supported &&
		state.mutable &&
		state.replica.status === "current" &&
		state.revision !== null;
	const fields = runtimeFields(descriptor);
	return (
		<form
			className="stack"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!editable || state.revision === null) return;
				setError("");
				setBusy(true);
				try {
					const changes = runtimeChanges(descriptor, drafts, initial);
					if (Object.keys(changes).length === 0) {
						setError("Change at least one setting before saving.");
						return;
					}
					const result = await saveRuntimeSettings(
						descriptor.key,
						state.revision,
						changes,
					);
					onSaved(
						`Saved revision ${result.committed_revision}. ${result.applied_by_responding_replica ? "Applied by this server; other replicas update asynchronously." : "Committed; application by this server is pending."}`,
					);
				} catch (cause) {
					setError(
						cause instanceof Error ? cause.message : "Unable to save settings.",
					);
				} finally {
					setBusy(false);
				}
			}}
		>
			<p className="muted">
				Source: {state.source}. Revision: {state.revision ?? "unavailable"}.
				Application: {state.replica.status}. Takes effect:{" "}
				{state.takes_effect.replaceAll("_", " ")}.
			</p>
			{state.constrained_by_ceiling && (
				<p role="status">
					This server applies a deployment limit. The form shows requested
					shared values; effective values are shown below.
				</p>
			)}
			{descriptor.requires_local_admin && (
				<p className="muted">
					Changes require a local administrator with password login configured.
				</p>
			)}
			{!descriptor.patch_supported && (
				<p className="muted">
					{descriptor.read_only_reason ??
						"This group requires a dedicated update workflow."}
				</p>
			)}
			{fields.map((field) => {
				const id = `runtime-${descriptor.key}-${field.name}`;
				const value = Object.hasOwn(drafts, field.name)
					? drafts[field.name]
					: initial[field.name];
				const hasHelp = Boolean(
					field.description ||
						Object.keys(field.choiceDescriptions ?? {}).length,
				);
				const helpId = hasHelp ? `${id}-help` : undefined;
				const readonly =
					!editable ||
					field.kind === "readonly" ||
					(typeof value === "number" &&
						field.kind === "integer" &&
						!Number.isSafeInteger(value));
				return (
					<div className="stack" key={field.name}>
						<label htmlFor={id}>
							{field.title}
							{field.unit ? ` (${field.unit})` : ""}
						</label>
						{readonly ? (
							<output id={id} aria-describedby={helpId}>
								{JSON.stringify(value) ?? "Unavailable"}
							</output>
						) : field.kind === "boolean" ? (
							<input
								id={id}
								type="checkbox"
								aria-describedby={helpId}
								checked={value === true}
								disabled={busy}
								onChange={(e) =>
									setDrafts({ ...drafts, [field.name]: e.target.checked })
								}
							/>
						) : field.kind === "enum" ? (
							<select
								id={id}
								aria-describedby={helpId}
								value={String(value ?? "")}
								disabled={busy}
								onChange={(e) =>
									setDrafts({ ...drafts, [field.name]: e.target.value })
								}
							>
								{field.choices?.map((choice) => (
									<option key={choice} value={choice}>
										{choice}
									</option>
								))}
							</select>
						) : (
							<input
								id={id}
								type={field.kind === "string" ? "text" : "number"}
								aria-describedby={helpId}
								step={field.kind === "integer" ? 1 : "any"}
								min={field.minimum}
								max={field.maximum}
								value={String(value ?? "")}
								disabled={busy}
								onChange={(e) =>
									setDrafts({ ...drafts, [field.name]: e.target.value })
								}
							/>
						)}
						{hasHelp && (
							<div id={helpId} className="muted">
								{field.description && <p>{field.description}</p>}
								{Object.keys(field.choiceDescriptions ?? {}).length > 0 && (
									<dl>
										{field.choices
											?.filter((choice) => field.choiceDescriptions?.[choice])
											.map((choice) => (
												<div key={choice}>
													<dt>{choice}</dt>
													<dd>{field.choiceDescriptions?.[choice]}</dd>
												</div>
											))}
									</dl>
								)}
							</div>
						)}
					</div>
				);
			})}
			{error && (
				<p className="error-banner" role="alert">
					{error}
				</p>
			)}
			<div className="toolbar">
				{editable && (
					<button type="submit" className="button" disabled={busy}>
						{busy ? "Saving…" : "Save settings"}
					</button>
				)}
				<button
					type="button"
					className="button secondary"
					disabled={busy}
					onClick={onReload}
				>
					Reload settings
				</button>
			</div>
			<details>
				<summary>Effective values</summary>
				<pre>{JSON.stringify(state.effective, null, 2)}</pre>
			</details>
		</form>
	);
}
