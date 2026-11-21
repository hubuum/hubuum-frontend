"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { GuidedFlowPanel, GuidedFlowTabs } from "@/components/guided-flow";
import { BackendConnectionPanel } from "@/components/backend-connection-panel";
import { ProviderInventory } from "@/components/provider-inventory";
import { SecuritySettingsEditor } from "@/components/security-settings-editor";
import type { SecurityConfigurationCapabilities } from "@/lib/api/generated/models";

import {
	RuntimeRevisionConflict,
	conflictingRuntimeFields,
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

export function RuntimeSettingsEditor({
	children,
	browserOrigin,
	authorizationAvailable,
}: {
	children: ReactNode;
	browserOrigin?: string | null;
	authorizationAvailable?: boolean;
}) {
	const router = useRouter();
	const [selectedTab, setSelectedTab] = useState("effective");
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
		{
			id: "effective",
			label: "Effective configuration",
			hint: "Read-only server snapshot",
		},
		...groups.map((descriptor) => ({
			id: `group-${descriptor.key}`,
			label: `${descriptor.title}${dirtyGroups[descriptor.key] ? " · Unsaved" : ""}`,
			hint:
				supported &&
				(descriptor.patch_supported ||
					Boolean(
						catalogue.data?.security &&
							["authentication", "authorization"].includes(descriptor.key),
					))
					? `Takes effect: ${descriptor.takes_effect.replaceAll("_", " ")}`
					: "Read only",
		})),
		{ id: "connection", label: "Connection", hint: "Frontend server target" },
	];
	const activeTab = steps.some((step) => step.id === selectedTab)
		? selectedTab
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
							capabilities={supported ? catalogue.data?.security : undefined}
							browserOrigin={browserOrigin}
							authorizationAvailable={authorizationAvailable}
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
			<div hidden={activeTab !== "connection"}>
				<GuidedFlowPanel idPrefix={tabPrefix} stepId="connection" tabIndex={0}>
					{activeTab === "connection" ? <BackendConnectionPanel /> : null}
				</GuidedFlowPanel>
			</div>
		</section>
	);
}

function SettingsGroup({
	descriptor,
	capabilities,
	browserOrigin,
	authorizationAvailable,
	supported,
	onDirtyChange,
	onSaved,
}: {
	descriptor: RuntimeSettingsDescriptor;
	capabilities?: SecurityConfigurationCapabilities;
	browserOrigin?: string | null;
	authorizationAvailable?: boolean;
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
			{state.data &&
			capabilities &&
			capabilities.candidate_endpoint ===
				"/api/v1/admin/runtime-settings/security-candidates" &&
			["authentication", "authorization"].includes(descriptor.key) ? (
				<SecuritySettingsEditor
					key={`${descriptor.key}-${state.data.revision}-${reloadVersion}`}
					state={state.data}
					capabilities={capabilities}
					browserOrigin={browserOrigin}
					authorizationAvailable={authorizationAvailable}
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
			) : state.data && descriptor.key === "authentication" ? (
				<>
					<ProviderInventory providers={state.data.effective.providers} />
					<p className="muted">
						{descriptor.read_only_reason ??
							"Provider editing requires server support for security candidates."}
					</p>
				</>
			) : (
				state.data && (
					<SettingsForm
						key={`${descriptor.key}-${reloadVersion}`}
						descriptor={descriptor}
						state={state.data}
						supported={supported}
						onDirtyChange={onDirtyChange}
						onRefresh={async () => {
							await state.refetch({ throwOnError: true });
						}}
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
				)
			)}
		</article>
	);
}

function SettingsForm({
	descriptor,
	state,
	supported,
	onReload,
	onRefresh,
	onSaved,
	onDirtyChange,
}: {
	descriptor: RuntimeSettingsDescriptor;
	state: RuntimeSettingsState;
	supported: boolean;
	onReload: () => Promise<void>;
	onRefresh: () => Promise<void>;
	onSaved: (message: string) => void;
	onDirtyChange: (group: string, dirty: boolean) => void;
}) {
	const [drafts, setDrafts] = useState<Record<string, string | boolean>>({});
	const [operation, setOperation] = useState<"save" | "reload" | null>(null);
	const busy = operation !== null;
	const [error, setError] = useState("");
	const initial = state.runtime ?? state.effective;
	const [original, setOriginal] = useState<Record<string, unknown>>({});
	const [staleRevision, setStaleRevision] = useState<number | null>(null);
	const needsRefresh =
		staleRevision !== null && (state.revision ?? 0) <= staleRevision;
	const conflicts = conflictingRuntimeFields(
		descriptor,
		drafts,
		original,
		initial,
	);
	function discardField(name: string) {
		setDrafts((current) => {
			const next = { ...current };
			delete next[name];
			return next;
		});
	}
	function edit(name: string, value: string | boolean) {
		if (!Object.hasOwn(drafts, name)) {
			setOriginal((current) => ({ ...current, [name]: initial[name] }));
		}
		if (runtimeDraftCount(descriptor, { [name]: value }, initial) === 0)
			discardField(name);
		else setDrafts((current) => ({ ...current, [name]: value }));
	}
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
				if (
					!editable ||
					busy ||
					needsRefresh ||
					conflicts.length ||
					state.revision === null
				)
					return;
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
					setDrafts({});
					setStaleRevision(null);
					onSaved(
						`Saved revision ${result.committed_revision}. ${result.applied_by_responding_replica ? "Applied by this server; other replicas update asynchronously." : "Committed; application by this server is pending."}`,
					);
				} catch (cause) {
					if (cause instanceof RuntimeRevisionConflict) {
						setStaleRevision(state.revision);
						await onRefresh().catch(() => {});
						return;
					}
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
					const limited =
						state.constrained_by_ceiling &&
						state.runtime !== null &&
						Object.hasOwn(state.runtime, field.name) &&
						Object.hasOwn(state.effective, field.name) &&
						initial[field.name] !== state.effective[field.name] &&
						field.kind !== "readonly";
					const hasHelp = Boolean(
						limited ||
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
										{limited && (
											<p>
												Requested {String(initial[field.name])} · Effective on
												this server {String(state.effective[field.name])}
											</p>
										)}
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
											onChange={(e) => edit(field.name, e.target.checked)}
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
										onChange={(e) => edit(field.name, e.target.value)}
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
										onChange={(e) => edit(field.name, e.target.value)}
									/>
								)}
								{conflicts.includes(field.name) && (
									<fieldset
										className="stack runtime-settings-notice"
										aria-label={`Resolve ${field.title}`}
									>
										<p>
											Your edit {String(value)} · Latest saved value{" "}
											{String(initial[field.name] ?? "unavailable")}
										</p>
										<div className="action-row">
											<button
												type="button"
												className="ghost"
												onClick={() =>
													setOriginal((current) => ({
														...current,
														[field.name]: initial[field.name],
													}))
												}
											>
												Keep my edit
											</button>
											<button
												type="button"
												className="ghost"
												onClick={() => discardField(field.name)}
											>
												Use saved value
											</button>
										</div>
									</fieldset>
								)}
							</div>
						</div>
					);
				})}
			</div>
			{staleRevision !== null && (
				<div className="runtime-settings-notice" role="alert">
					{needsRefresh ? (
						<>
							The server has a newer revision.{" "}
							<button
								type="button"
								className="ghost"
								disabled={busy}
								onClick={() => void onRefresh().catch(() => {})}
							>
								Fetch latest values
							</button>
						</>
					) : conflicts.length ? (
						"Another administrator saved changes. Resolve the highlighted fields before saving."
					) : (
						"Latest saved values loaded. Review your edits before saving."
					)}
				</div>
			)}
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
							<button
								type="submit"
								disabled={
									busy ||
									dirtyCount === 0 ||
									needsRefresh ||
									conflicts.length > 0
								}
							>
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
