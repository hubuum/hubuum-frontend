"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { GuidedFlowPanel, GuidedFlowTabs } from "@/components/guided-flow";

import {
	fetchRuntimeSettingsCatalogue,
	fetchRuntimeSettingsGroup,
	type RuntimeSettingsDescriptor,
	type RuntimeSettingsState,
	runtimeChanges,
	runtimeDraftCount,
	runtimeFields,
	saveRuntimeSettings,
} from "@/lib/api/runtime-settings";

const tabPrefix = "runtime-settings";

export function RuntimeSettingsEditor({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [selectedTab, setSelectedTab] = useState<string | null>(null);
	const [dirtyGroups, setDirtyGroups] = useState<Record<string, boolean>>({});
	const onDirtyChange = useCallback((group: string, dirty: boolean) => {
		setDirtyGroups((current) =>
			current[group] === dirty ? current : { ...current, [group]: dirty },
		);
	}, []);
	const catalogue = useQuery({
		queryKey: ["runtime-settings-catalogue"],
		queryFn: fetchRuntimeSettingsCatalogue,
		retry: false,
	});
	const groups = catalogue.data?.groups ?? [];
	const supported = catalogue.data?.schema_version === 1;
	const steps = [
		...groups.map((descriptor) => ({
			id: `group-${descriptor.key}`,
			label: `${descriptor.title}${dirtyGroups[descriptor.key] ? " · Unsaved" : ""}`,
			hint:
				supported && descriptor.patch_supported
					? `Takes effect: ${descriptor.takes_effect.replaceAll("_", " ")}`
					: "Read only",
		})),
		{
			id: "effective",
			label: "Effective configuration",
			hint: "Read-only server snapshot",
		},
	];
	const defaultGroup =
		groups.find((group) => group.patch_supported) ?? groups[0];
	const activeTab =
		selectedTab && steps.some((step) => step.id === selectedTab)
			? selectedTab
			: defaultGroup
				? `group-${defaultGroup.key}`
				: "effective";
	return (
		<section
			className="stack runtime-settings-editor"
			aria-label="Editable runtime settings"
		>
			{catalogue.isPending && (
				<p role="status">Loading supported runtime settings…</p>
			)}
			{catalogue.error && (
				<p className="error-banner" role="alert">
					{catalogue.error.message}
				</p>
			)}
			{catalogue.isSuccess && groups.length === 0 && (
				<p className="muted">
					This server does not advertise editable runtime settings. Effective
					configuration is shown below.
				</p>
			)}
			{catalogue.data && !supported && (
				<p className="error-banner">
					This settings catalogue requires a newer frontend. Settings are
					read-only.
				</p>
			)}
			<GuidedFlowTabs
				activeStep={activeTab}
				ariaLabel="Configuration groups"
				className="runtime-settings-tabs"
				idPrefix={tabPrefix}
				numbered={false}
				onChange={setSelectedTab}
				steps={steps}
			/>
			{groups.map((descriptor) => (
				// Keep inactive forms mounted so switching tabs preserves drafts.
				<div
					key={descriptor.key}
					hidden={activeTab !== `group-${descriptor.key}`}
				>
					<GuidedFlowPanel
						idPrefix={tabPrefix}
						stepId={`group-${descriptor.key}`}
					>
						<SettingsGroup
							descriptor={descriptor}
							supported={supported}
							onDirtyChange={onDirtyChange}
							onSaved={() => router.refresh()}
						/>
					</GuidedFlowPanel>
				</div>
			))}
			<div hidden={activeTab !== "effective"}>
				<GuidedFlowPanel idPrefix={tabPrefix} stepId="effective" tabIndex={0}>
					<header className="stack action-card-header">
						<h3>Effective configuration</h3>
						<p className="muted">
							Read-only server snapshot. Secrets and sensitive values are
							redacted.
						</p>
					</header>
					{children}
				</GuidedFlowPanel>
			</div>
		</section>
	);
}

function SettingsGroup({
	descriptor,
	supported,
	onDirtyChange,
	onSaved,
}: {
	descriptor: RuntimeSettingsDescriptor;
	supported: boolean;
	onDirtyChange: (group: string, dirty: boolean) => void;
	onSaved: () => void;
}) {
	const state = useQuery({
		queryKey: ["runtime-settings", descriptor.key],
		queryFn: () => fetchRuntimeSettingsGroup(descriptor.key),
		retry: false,
		refetchOnReconnect: false,
	});
	const [notice, setNotice] = useState("");
	const [reloadVersion, setReloadVersion] = useState(0);
	return (
		<article className="card stack">
			<header className="stack action-card-header">
				<h3>{descriptor.title}</h3>
				<p className="muted">{descriptor.description}</p>
			</header>
			{state.isPending && <p role="status">Loading settings…</p>}
			{state.error && (
				<p className="error-banner" role="alert">
					{state.error.message}
				</p>
			)}
			{notice && <p role="status">{notice}</p>}
			{state.data && (
				<SettingsForm
					key={`${descriptor.key}-${state.data.revision}-${reloadVersion}`}
					descriptor={descriptor}
					state={state.data}
					supported={supported}
					onDirtyChange={onDirtyChange}
					onReload={async () => {
						const result = await state.refetch();
						if (result.isSuccess) {
							setNotice("");
							setReloadVersion((version) => version + 1);
						}
					}}
					onSaved={(message) => {
						setNotice(message);
						void state.refetch();
						onSaved();
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
	onDirtyChange,
}: {
	descriptor: RuntimeSettingsDescriptor;
	state: RuntimeSettingsState;
	supported: boolean;
	onReload: () => Promise<void>;
	onSaved: (message: string) => void;
	onDirtyChange: (group: string, dirty: boolean) => void;
}) {
	const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
	const [operation, setOperation] = useState<"save" | "reload" | null>(null);
	const busy = operation !== null;
	const [error, setError] = useState("");
	const initial = state.runtime ?? state.effective;
	const editable =
		supported &&
		descriptor.patch_supported &&
		state.mutable &&
		state.replica.status === "current" &&
		state.revision !== null;
	const fields = runtimeFields(descriptor);
	const dirtyCount = runtimeDraftCount(descriptor, drafts, initial);
	useEffect(() => {
		onDirtyChange(descriptor.key, dirtyCount > 0);
	}, [descriptor.key, dirtyCount, onDirtyChange]);
	async function reload() {
		setOperation("reload");
		try {
			await onReload();
		} finally {
			setOperation(null);
		}
	}
	return (
		<form
			className="stack"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!editable || busy || state.revision === null) return;
				setError("");
				setOperation("save");
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
					setOperation(null);
				}
			}}
		>
			<dl className="runtime-settings-meta">
				<div>
					<dt>Source</dt>
					<dd>{state.source}</dd>
				</div>
				<div>
					<dt>Revision</dt>
					<dd>{state.revision ?? "unavailable"}</dd>
				</div>
				<div>
					<dt>Application</dt>
					<dd>{state.replica.status.replaceAll("_", " ")}</dd>
				</div>
				<div>
					<dt>Takes effect</dt>
					<dd>{state.takes_effect.replaceAll("_", " ")}</dd>
				</div>
			</dl>
			{state.constrained_by_ceiling && (
				<p className="runtime-settings-notice" role="status">
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
			<div className="runtime-settings-fields">
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
						<div className="runtime-settings-field" key={field.name}>
							<div className="runtime-settings-field-copy">
								<label htmlFor={id}>
									{field.title}
									{field.unit ? ` (${field.unit})` : ""}
								</label>
								{hasHelp && (
									<div id={helpId} className="muted runtime-settings-help">
										{field.description && <p>{field.description}</p>}
										{Object.keys(field.choiceDescriptions ?? {}).length > 0 && (
											<dl>
												{field.choices
													?.filter(
														(choice) => field.choiceDescriptions?.[choice],
													)
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
							<div
								className={`runtime-settings-control${field.kind === "string" ? " runtime-settings-control--text" : ""}`}
							>
								{readonly ? (
									<output id={id} aria-describedby={helpId}>
										{JSON.stringify(value) ?? "Unavailable"}
									</output>
								) : field.kind === "boolean" ? (
									<label className="checkbox-row runtime-settings-checkbox">
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
										<span aria-hidden="true">
											{value === true ? "Enabled" : "Disabled"}
										</span>
									</label>
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
							</div>
						</div>
					);
				})}
			</div>
			{error && (
				<div className="error-banner stack action-card-header" role="alert">
					<p>{error}</p>
					<div className="action-row">
						<button
							type="button"
							className="ghost"
							disabled={busy}
							onClick={reload}
						>
							{operation === "reload" ? "Reloading…" : "Reload settings"}
						</button>
					</div>
				</div>
			)}
			<div className="runtime-settings-actions">
				<span className="muted" role="status">
					{dirtyCount > 0
						? `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`
						: editable
							? "No unsaved changes"
							: "Read only"}
				</span>
				<div className="action-row">
					{editable && (
						<>
							<button
								type="button"
								className="ghost"
								disabled={busy || dirtyCount === 0}
								onClick={() => {
									setDrafts({});
									setError("");
								}}
							>
								Discard
							</button>
							<button type="submit" disabled={busy || dirtyCount === 0}>
								{operation === "save" ? "Saving…" : "Save changes"}
							</button>
						</>
					)}
				</div>
			</div>
			<details className="runtime-settings-details">
				<summary>Effective values</summary>
				<pre>{JSON.stringify(state.effective, null, 2)}</pre>
				<button
					type="button"
					className="ghost"
					disabled={busy}
					onClick={reload}
				>
					{operation === "reload" ? "Reloading…" : "Reload settings"}
				</button>
			</details>
		</form>
	);
}
