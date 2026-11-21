"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { BrowserAuthentication } from "@/components/browser-authentication";
import { ProviderInventory } from "@/components/provider-inventory";
import { CreateModal } from "@/components/create-modal";
import type {
	SecurityConfigurationCapabilities,
	SecurityCandidateRequest,
	ProviderCredentialInput,
} from "@/lib/api/generated/models";
import type { RuntimeSettingsState } from "@/lib/api/runtime-settings";
import {
	activateCandidate,
	createCandidate,
	discardCandidate,
	publicPreviewSchema,
	readCandidate,
	verifyLdapCandidate,
	type PublicCandidate,
	type PublicPreview,
} from "@/lib/api/security-candidates";
import {
	approvalAuthenticationMethod,
	beginBrowserAuthentication,
	cancelBrowserAuthentication,
	type BrowserAuthenticationFlow,
} from "@/lib/browser-authentication";
import {
	authenticationDraft,
	authorizationDraft,
	authorizationReleaseRequest,
	providerCallback,
} from "@/lib/security-settings";
import {
	copyableDefinition,
	duplicateProvider,
	parseProviderSettings,
	providerChangeSummary,
	providerRequest,
	providerTemplate,
	securityCandidateInput,
	type ExternalProviderKind,
	type ProviderDraft,
} from "@/lib/security-candidate";

type Props = {
	state: RuntimeSettingsState;
	capabilities: SecurityConfigurationCapabilities;
	browserOrigin?: string | null;
	authorizationAvailable?: boolean;
	onDirtyChange: (group: string, dirty: boolean) => void;
	onReload: () => Promise<void>;
	onSaved: (message: string) => void;
};
const message = (error: unknown) =>
	error instanceof Error
		? error.message
		: "The operation could not be confirmed. Reload configuration before retrying.";

function LdapCopyFields({
	draft,
	onChange,
}: {
	draft: ProviderDraft;
	onChange: (text: string) => void;
}) {
	let settings: Record<string, unknown>;
	try {
		settings = parseProviderSettings(draft.configurationText);
	} catch {
		return <p>Correct the advanced JSON to edit the directory fields.</p>;
	}
	return (
		<div className="runtime-settings-fields">
			{Object.entries({
				url: "Directory URL",
				user_base_dn: "User search base DN",
				user_filter: "User search filter",
				bind_dn: "Service bind DN",
			}).map(([key, label]) => (
				<label className="runtime-settings-field" key={key}>
					{label}
					<input
						value={String(settings[key] ?? "")}
						required={key !== "bind_dn"}
						onChange={(event) => {
							const text = event.target.value;
							onChange(
								JSON.stringify(
									{
										...settings,
										[key]: key === "bind_dn" && !text ? null : text,
									},
									null,
									2,
								),
							);
						}}
					/>
				</label>
			))}
		</div>
	);
}

export function SecuritySettingsEditor(props: Props) {
	let initial: ReturnType<typeof authenticationDraft> | null = null;
	let authz: ReturnType<typeof authorizationDraft> | null = null;
	try {
		if (props.state.group === "authentication")
			initial = authenticationDraft(props.state);
		else authz = authorizationDraft(props.state);
	} catch {
		return (
			<div className="stack">
				{props.state.group === "authentication" && (
					<ProviderInventory providers={props.state.effective.providers} />
				)}
				<p className="error-banner" role="alert">
					The security configuration is not supported by this frontend. It is
					read-only; upgrade the frontend before editing.
				</p>
				<button
					type="button"
					className="ghost"
					onClick={() => void props.onReload()}
				>
					Reload configuration
				</button>
			</div>
		);
	}
	return (
		<SecurityForm {...props} initial={initial} initialAuthorization={authz} />
	);
}

function SecurityForm({
	state,
	capabilities,
	browserOrigin,
	authorizationAvailable,
	onDirtyChange,
	onReload,
	onSaved,
	initial,
	initialAuthorization,
}: Props & {
	initial: ReturnType<typeof authenticationDraft> | null;
	initialAuthorization: ReturnType<typeof authorizationDraft> | null;
}) {
	const prefix = useId();
	const [drafts, setDrafts] = useState(initial?.drafts ?? []);
	const focusDraft = useRef<string | null>(null);
	const [backend, setBackend] = useState(
		initialAuthorization?.backend ?? "local",
	);
	const [source, setSource] = useState(
		initialAuthorization?.source ?? "runtime",
	);
	const [url, setUrl] = useState(initialAuthorization?.connection?.url ?? "");
	const [trust, setTrust] = useState(
		initialAuthorization?.connection?.trust_profile_id ?? "",
	);
	const [connectTimeout, setConnectTimeout] = useState(
		initialAuthorization?.connection?.connect_timeout_ms ?? 1000,
	);
	const [requestTimeout, setRequestTimeout] = useState(
		initialAuthorization?.connection?.request_timeout_ms ?? 3000,
	);
	const [release, setRelease] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [candidate, setCandidate] = useState<PublicCandidate | null>(null);
	const [summary, setSummary] = useState<string[]>([]);
	const [preview, setPreview] = useState<PublicPreview | null>(null);
	const [flow, setFlow] = useState<BrowserAuthenticationFlow | null>(null);
	const flowRef = useRef(flow);
	flowRef.current = flow;
	const [approval, setApproval] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const verificationProvider = useRef<string | null>(null);
	const [now, setNow] = useState(Date.now());
	const formRef = useRef<HTMLFormElement>(null);
	const approvalPassword = useRef<HTMLInputElement>(null);

	const actor = useQuery({
		queryKey: ["security-settings-local-actor"],
		queryFn: async () =>
			(await approvalAuthenticationMethod())?.kind === "local",
		retry: false,
	});
	useEffect(() => {
		onDirtyChange(state.group, dirty || candidate !== null);
	}, [dirty, candidate, state.group, onDirtyChange]);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	useEffect(
		() => () => {
			if (flowRef.current)
				void cancelBrowserAuthentication(flowRef.current).catch(() => {});
		},
		[],
	);
	const expired = candidate !== null && Date.parse(candidate.expires_at) <= now;
	const editable =
		state.mutable &&
		state.replica.status === "current" &&
		state.revision !== null &&
		actor.data === true;
	const frozen = !editable || busy || candidate !== null;
	function change(index: number, patch: Partial<ProviderDraft>) {
		setDirty(true);
		setDrafts((current) =>
			current.map((item, at) => (at === index ? { ...item, ...patch } : item)),
		);
	}
	async function run(action: () => Promise<void>) {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await action();
		} catch (caught) {
			setError(message(caught));
		} finally {
			setBusy(false);
		}
	}
	async function prepare() {
		if (!editable || state.revision === null || candidate) return;
		if (initial && !release) {
			const names = new Set(["local"]);
			for (const draft of drafts) {
				if (!draft.name.trim() || names.has(draft.name))
					throw new Error("Each provider needs a unique login scope.");
				names.add(draft.name);
			}
		}
		const data = new FormData(formRef.current ?? undefined);
		// Credentials and aliases never enter React state or the review summary.
		formRef.current
			?.querySelectorAll<HTMLInputElement>("input[data-write-only]")
			.forEach((input) => {
				input.value = "";
			});
		let request: SecurityCandidateRequest;
		if (state.group === "authentication") {
			const providers = release
				? []
				: drafts.map((draft) => {
						const input = String(data.get(`credential-${draft.key}`) ?? "");
						const secret: ProviderCredentialInput =
							draft.credentialAction === "reference"
								? { action: "reference", alias: input }
								: draft.credentialAction === "replace"
									? { action: "replace", value: input }
									: { action: draft.credentialAction };
						return providerRequest(draft, secret);
					});
			request = {
				group: "authentication",
				expected_revision: state.revision,
				release_ownership: release,
				...(release ? {} : { providers }),
			};
		} else if (release) {
			request = authorizationReleaseRequest(state);
		} else {
			request = {
				group: "authorization",
				expected_revision: state.revision,
				backend,
				source,
				release_ownership: release,
				...(backend === "treetop" && source === "runtime" && !release
					? {
							connection: {
								url,
								trust_profile_id: trust,
								connect_timeout_ms: connectTimeout,
								request_timeout_ms: requestTimeout,
							},
						}
					: {}),
			};
		}
		const next = await createCandidate(securityCandidateInput.parse(request));
		if (next.group !== state.group || next.base_revision !== state.revision)
			throw new Error(
				"The candidate does not match this configuration. Reload before proceeding.",
			);
		setSummary(
			release
				? [
						state.group === "authorization"
							? `Release runtime ownership to deployment ${initialAuthorization?.deploymentBackend}. Other draft changes are ignored.`
							: "Release runtime ownership to deployment configuration.",
					]
				: state.group === "authentication"
					? [
							...providerChangeSummary(initial?.drafts ?? [], drafts),
							...(state.source === "deployment"
								? [
										"Activation moves the sign-in selection to runtime management. Future deployment providers will need to be enabled here.",
									]
								: []),
						]
					: [
							`${backend}, ${source}${backend === "treetop" && source === "runtime" ? `; ${url}; trust profile ${trust}; timeouts ${connectTimeout}/${requestTimeout} ms` : ""}.`,
						],
		);
		setCandidate(next);
		setPreview(null);
		setUncertain(false);
	}
	async function acceptPreview(payload: unknown, providerId: string) {
		const next = publicPreviewSchema.parse(payload);
		if (
			!candidate ||
			next.candidate.id !== candidate.id ||
			next.candidate.base_revision !== candidate.base_revision ||
			next.verification.candidate_id !== candidate.id ||
			next.verification.provider_id !== providerId
		)
			throw new Error(
				"The verification result does not match this candidate. Recreate and test it again.",
			);
		setCandidate(next.candidate);
		setPreview(next.verification);
	}
	return (
		<div className="stack">
			<p>
				Source: {state.source}. Revision: {state.revision ?? "unavailable"}.
				Responding replica: {state.replica.status}. Replicas apply changes
				independently.
			</p>
			{state.group === "authentication" ? (
				<p>
					Local accounts remain available for recovery. A candidate changes
					external providers only; creating or testing one does not activate it.
				</p>
			) : (
				<p>
					Authorization is{" "}
					{authorizationAvailable === false
						? "unavailable on the responding replica"
						: authorizationAvailable === true
							? "available on the responding replica"
							: "not confirmed by this snapshot"}
					. Treetop requires a server built with Treetop support, successful
					connectivity and administrator access checks.
				</p>
			)}
			{initial && (
				<ProviderInventory
					providers={initial.providers}
					action={(name) => {
						const provider = initial.providers.find(
							(item) => item.name === name,
						);
						if (
							!provider ||
							provider.kind === "local" ||
							!capabilities.configurable_provider_kinds.includes(provider.kind)
						)
							return null;
						if (!copyableDefinition(provider))
							return <span className="muted">Copy settings unavailable</span>;
						return (
							<button
								type="button"
								className="ghost"
								disabled={frozen || release}
								aria-label={`Duplicate ${name}`}
								onClick={() => {
									try {
										const copy = duplicateProvider(provider);
										focusDraft.current = copy.key;
										setDrafts((current) => [...current, copy]);
										setDirty(true);
									} catch (cause) {
										setError(message(cause));
									}
								}}
							>
								Duplicate
							</button>
						);
					}}
				/>
			)}
			{actor.isPending ? (
				<p role="status">Checking administrator identity…</p>
			) : actor.data !== true ? (
				<p className="error-banner" role="alert">
					Sign in with a local, unscoped human administrator to change security
					settings.
				</p>
			) : null}
			{!state.mutable || state.replica.status !== "current" ? (
				<p className="error-banner">
					This group cannot be edited on this replica. Check deployment
					constraints and replica status, then reload.
				</p>
			) : null}
			{error && (
				<p className="error-banner" role="alert">
					{error}
				</p>
			)}
			<form
				className="stack"
				ref={formRef}
				noValidate={release}
				onInvalidCapture={(event) => {
					const details = (event.target as HTMLElement).closest("details");
					if (details) details.open = true;
				}}
				onSubmit={(event) => {
					event.preventDefault();
					void run(prepare);
				}}
			>
				<fieldset className="stack" disabled={frozen}>
					<legend>
						{state.group === "authentication"
							? "Authentication providers"
							: "Authorization backend"}
					</legend>
					{state.group === "authentication" ? (
						<>
							<p>
								<strong>Local accounts — always on</strong>
							</p>
							{drafts.map((draft, index) => {
								const status = initial?.providers.find(
									(provider) =>
										(provider.provider_id ?? `deployment:${provider.name}`) ===
										draft.key,
								);
								const locked = Boolean(
									status &&
										capabilities.deployment_locked_providers.includes(
											status.name,
										),
								);
								return (
									<details
										className="runtime-settings-details"
										key={draft.key}
										open={!status || initial?.drafts.length === 1}
									>
										<summary>
											{status
												? `Settings for ${status.name}`
												: `New ${draft.kind.toUpperCase()} provider`}
										</summary>
										<fieldset className="stack" disabled={locked}>
											<legend>
												{draft.name || "New provider"} ({draft.kind})
											</legend>
											{draft.copiedFrom && (
												<p>
													Copied from <strong>{draft.copiedFrom}</strong>. The
													new login scope has its own users, groups and
													credentials.
												</p>
											)}
											{status && (
												<p>
													Source: {status.source}.{" "}
													{status.available
														? "Applied adapter available."
														: "Applied adapter unavailable."}{" "}
													{status.source === "deployment"
														? "Credentials are managed by deployment."
														: status.credential_configured
															? "A credential is configured."
															: "No credential is configured."}
												</p>
											)}
											{locked && (
												<p>
													Locked by deployment; this provider cannot be changed
													here.
												</p>
											)}
											<label
												className="stack"
												htmlFor={`${prefix}-name-${draft.key}`}
											>
												{draft.copiedFrom ? "New login scope" : "Provider name"}
												<input
													id={`${prefix}-name-${draft.key}`}
													ref={(node) => {
														if (node && focusDraft.current === draft.key) {
															node.focus();
															focusDraft.current = null;
														}
													}}
													value={draft.name}
													readOnly={Boolean(status)}
													required
													maxLength={160}
													onChange={(event) =>
														change(index, { name: event.target.value })
													}
												/>
											</label>
											<label>
												<input
													type="checkbox"
													checked={draft.enabled}
													onChange={(event) =>
														change(index, { enabled: event.target.checked })
													}
												/>{" "}
												Enabled
											</label>
											<label
												className="stack"
												htmlFor={`${prefix}-source-${index}`}
											>
												Definition source
												<select
													id={`${prefix}-source-${index}`}
													value={draft.source}
													onChange={(event) =>
														change(index, {
															source:
																event.target.value === "runtime"
																	? "runtime"
																	: "deployment",
															adoptDeployment:
																status?.source === "deployment" &&
																event.target.value === "runtime",
														})
													}
												>
													<option value="runtime">Runtime definition</option>
													{status?.source === "deployment" && (
														<option value="deployment">
															Deployment reference
														</option>
													)}
												</select>
											</label>
											{draft.adoptDeployment && (
												<p>
													This candidate explicitly adopts the deployment
													definition into runtime management. Review every
													setting.
												</p>
											)}
											{draft.source === "runtime" && (
												<>
													{draft.kind === "ldap" && draft.copiedFrom && (
														<LdapCopyFields
															draft={draft}
															onChange={(configurationText) =>
																change(index, { configurationText })
															}
														/>
													)}
													<details open={!draft.copiedFrom}>
														<summary>Advanced provider settings</summary>
														<label
															className="stack"
															htmlFor={`${prefix}-config-${index}`}
														>
															Non-secret provider settings (JSON)
															<textarea
																id={`${prefix}-config-${index}`}
																value={draft.configurationText}
																rows={12}
																spellCheck={false}
																onChange={(event) =>
																	change(index, {
																		configurationText: event.target.value,
																	})
																}
															/>
														</label>
													</details>
													<p className="muted">
														Set connection, identity admission and membership
														policy here. Keep passwords, client secrets and
														credential aliases in the write-only controls below.
														{draft.kind === "ldap" &&
															(draft.copiedFrom
																? "The new login scope is applied when the candidate is prepared."
																: "LDAP scope must match the provider name.")}
													</p>
													<label
														className="stack"
														htmlFor={`${prefix}-action-${index}`}
													>
														Credential action
														<select
															id={`${prefix}-action-${index}`}
															value={draft.credentialAction}
															onChange={(event) =>
																change(index, {
																	credentialAction: event.target
																		.value as ProviderDraft["credentialAction"],
																})
															}
														>
															{!draft.copiedFrom && (
																<option value="keep">
																	Keep existing credential
																</option>
															)}
															<option value="reference">
																Reference a deployment secret alias
															</option>
															{capabilities.replacement_credentials_available && (
																<option value="replace">
																	Replace with a new credential
																</option>
															)}
															<option value="clear">
																{draft.copiedFrom
																	? "No credential"
																	: "Clear credential"}
															</option>
														</select>
													</label>
													{(draft.credentialAction === "reference" ||
														draft.credentialAction === "replace") && (
														<label
															className="stack"
															htmlFor={`${prefix}-secret-${index}`}
															key={draft.credentialAction}
														>
															{draft.credentialAction === "reference"
																? "Credential alias (write only)"
																: "New credential (write only)"}
															<input
																id={`${prefix}-secret-${index}`}
																name={`credential-${draft.key}`}
																type="password"
																autoComplete="off"
																data-write-only
																required
																maxLength={16384}
															/>
														</label>
													)}
													{draft.credentialAction === "clear" && (
														<p>
															Clearing removes the configured credential. For
															LDAP, remove the bind DN too when changing to
															anonymous bind. Other settings must remain valid;
															providers requiring a secret must stay disabled.
														</p>
													)}
												</>
											)}
											{!status && (
												<button
													type="button"
													className="ghost"
													onClick={() => {
														setDrafts((current) =>
															current.filter((item) => item.key !== draft.key),
														);
														setDirty(true);
													}}
												>
													Remove new provider
												</button>
											)}
										</fieldset>
									</details>
								);
							})}
							<div className="actions">
								{(["ldap", "oidc", "oauth"] as ExternalProviderKind[])
									.filter((kind) =>
										capabilities.configurable_provider_kinds.includes(kind),
									)
									.map((kind) => (
										<button
											type="button"
											className="ghost"
											key={kind}
											onClick={() => {
												const key = crypto.randomUUID();
												setDrafts((current) => [
													...current,
													{
														key,
														name: "",
														kind,
														source: "runtime",
														enabled: false,
														adoptDeployment: false,
														configurationText: JSON.stringify(
															providerTemplate(kind, ""),
															null,
															2,
														),
														credentialAction: "keep",
													},
												]);
												setDirty(true);
											}}
										>
											Add{" "}
											{kind === "ldap"
												? "LDAP"
												: kind === "oidc"
													? "OIDC"
													: "OAuth"}{" "}
											provider
										</button>
									))}
							</div>
						</>
					) : (
						<>
							<label className="stack" htmlFor={`${prefix}-backend`}>
								Backend
								<select
									id={`${prefix}-backend`}
									value={backend}
									onChange={(event) => {
										setBackend(event.target.value as "local" | "treetop");
										setDirty(true);
									}}
								>
									<option value="local">Local</option>
									<option value="treetop">Treetop</option>
								</select>
							</label>
							<label className="stack" htmlFor={`${prefix}-authz-source`}>
								Connection source
								<select
									id={`${prefix}-authz-source`}
									value={source}
									onChange={(event) => {
										setSource(event.target.value as "runtime" | "deployment");
										setDirty(true);
									}}
								>
									<option value="runtime">Runtime</option>
									<option value="deployment">Deployment</option>
								</select>
							</label>
							{backend === "treetop" && source === "runtime" && (
								<>
									<label className="stack" htmlFor={`${prefix}-url`}>
										Treetop HTTPS URL
										<input
											id={`${prefix}-url`}
											type="url"
											value={url}
											required
											onChange={(event) => {
												setUrl(event.target.value);
												setDirty(true);
											}}
										/>
									</label>
									<label className="stack" htmlFor={`${prefix}-trust`}>
										Trust profile
										<select
											id={`${prefix}-trust`}
											required
											value={trust}
											onChange={(event) => {
												setTrust(event.target.value);
												setDirty(true);
											}}
										>
											<option value="">
												Choose a deployment trust profile
											</option>
											{capabilities.trust_profiles.map((profile) => (
												<option key={profile} value={profile}>
													{profile}
												</option>
											))}
										</select>
									</label>
									<label className="stack" htmlFor={`${prefix}-connect`}>
										Connect timeout (ms)
										<input
											id={`${prefix}-connect`}
											type="number"
											min={1}
											max={capabilities.treetop_connect_timeout_ceiling_ms}
											value={connectTimeout}
											onChange={(event) => {
												setConnectTimeout(event.target.valueAsNumber);
												setDirty(true);
											}}
										/>
									</label>
									<label className="stack" htmlFor={`${prefix}-request`}>
										Request timeout (ms)
										<input
											id={`${prefix}-request`}
											type="number"
											min={1}
											max={capabilities.treetop_request_timeout_ceiling_ms}
											value={requestTimeout}
											onChange={(event) => {
												setRequestTimeout(event.target.valueAsNumber);
												setDirty(true);
											}}
										/>
									</label>
								</>
							)}
						</>
					)}
					<label>
						<input
							type="checkbox"
							checked={release}
							disabled={
								state.group === "authorization" &&
								!initialAuthorization?.deploymentBackend
							}
							onChange={(event) => {
								setRelease(event.target.checked);
								setDirty(true);
							}}
						/>{" "}
						Release this group to deployment configuration
					</label>
					{state.group === "authorization" && (
						<p className="muted">
							{initialAuthorization?.deploymentBackend
								? `Release restores deployment ${initialAuthorization.deploymentBackend}; other draft changes are ignored.`
								: "Deployment authorization configuration is unavailable. Reload before releasing ownership."}
						</p>
					)}
					<button type="submit" disabled={!dirty}>
						Prepare candidate
					</button>
				</fieldset>
			</form>
			{candidate && (
				<section className="stack" aria-label="Security candidate review">
					<h4>Review and test candidate</h4>
					<p>
						Candidate{" "}
						<code style={{ overflowWrap: "anywhere" }}>{candidate.id}</code> ·{" "}
						{candidate.group} · base revision {candidate.base_revision} ·{" "}
						{expired ? "expired" : candidate.state}. Expires{" "}
						{new Date(candidate.expires_at).toLocaleString()}.
					</p>
					<ul>
						{summary.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
					<p>
						Changes remain inactive until you approve activation with your local
						password.
					</p>
					<ul>
						{candidate.checks.map((check) => (
							<li key={`${check.kind}-${check.provider_id}-${check.reason}`}>
								{check.kind}: {check.status}
								{check.reason ? ` — ${check.reason}` : ""}
							</li>
						))}
					</ul>
					{candidate.providers.map((provider) => (
						<section
							className="stack"
							key={provider.provider_id}
							aria-label={`Test ${provider.name}`}
						>
							<h5>
								{provider.name} ({provider.kind})
							</h5>
							{provider.kind === "ldap" ? (
								<form
									className="stack"
									onSubmit={(event) => {
										event.preventDefault();
										const form = event.currentTarget;
										const data = new FormData(form);
										form.reset();
										void run(async () => {
											const result = await verifyLdapCandidate(
												candidate.id,
												provider.provider_id,
												String(data.get("username") ?? ""),
												String(data.get("password") ?? ""),
											);
											await acceptPreview(result, provider.provider_id);
										});
									}}
								>
									<label
										className="stack"
										htmlFor={`${prefix}-ldap-user-${provider.provider_id}`}
									>
										Test username
										<input
											id={`${prefix}-ldap-user-${provider.provider_id}`}
											name="username"
											autoComplete="off"
											required
										/>
									</label>
									<label
										className="stack"
										htmlFor={`${prefix}-ldap-pw-${provider.provider_id}`}
									>
										Test password
										<input
											id={`${prefix}-ldap-pw-${provider.provider_id}`}
											name="password"
											type="password"
											autoComplete="off"
											required
										/>
									</label>
									<button
										disabled={busy || flow !== null || expired}
										type="submit"
									>
										Test LDAP provider
									</button>
								</form>
							) : (
								<>
									{providerCallback(browserOrigin, provider.provider_id) ? (
										<p>
											Register this exact callback with the identity provider:{" "}
											<code style={{ overflowWrap: "anywhere" }}>
												{providerCallback(browserOrigin, provider.provider_id)}
											</code>
										</p>
									) : (
										<p className="error-banner">
											Browser verification requires a public authentication
											origin configured on this Hubuum server. Configure its
											trusted origin and the frontend return registration first.
										</p>
									)}
									<button
										type="button"
										disabled={
											busy ||
											flow !== null ||
											expired ||
											!providerCallback(browserOrigin, provider.provider_id)
										}
										onClick={() =>
											void run(async () => {
												const next = await beginBrowserAuthentication({
													purpose: "provider_verification",
													candidate_id: candidate.id,
													provider_id: provider.provider_id,
													return_path: "/admin/configuration",
												});
												verificationProvider.current = provider.provider_id;
												setFlow(next);
											})
										}
									>
										Test {provider.kind === "oidc" ? "OIDC" : "OAuth"} provider
									</button>
								</>
							)}
						</section>
					))}
					{flow && (
						<BrowserAuthentication
							key={flow.id}
							flow={flow}
							onCancel={() => setFlow(null)}
							onComplete={(result) => {
								const parsed = publicPreviewSchema.safeParse(result);
								if (!parsed.success) {
									setError(
										"The provider verification result could not be confirmed.",
									);
									setFlow(null);
									return;
								}
								void run(async () => {
									await acceptPreview(
										result,
										verificationProvider.current ?? "",
									);
									setFlow(null);
								});
							}}
						/>
					)}
					{preview && (
						<section aria-label="Identity preview" className="stack">
							<h5>Identity preview</h5>
							<p>
								Subject: {preview.subject}. Admission:{" "}
								{preview.admitted ? "allowed" : "denied"}. Membership:{" "}
								{preview.membership}.
							</p>
							<ul>
								{preview.groups.map((group) => (
									<li key={group.key}>
										{group.name} ({group.key})
									</li>
								))}
							</ul>
							<p>
								No account was provisioned and no login session was issued by
								this test.
							</p>
						</section>
					)}
					<button
						type="button"
						className="ghost"
						disabled={busy || flow !== null}
						onClick={() =>
							void run(async () => {
								const latest = await readCandidate(candidate.id);
								if (
									latest.id !== candidate.id ||
									latest.base_revision !== candidate.base_revision
								)
									throw new Error(
										"Candidate changed. Recreate and test it again.",
									);
								setCandidate(latest);
								if (uncertain) {
									await onReload();
								}
							})
						}
					>
						Check candidate status{uncertain ? " and reload configuration" : ""}
					</button>
					{uncertain && (
						<p className="error-banner">
							Activation could not be confirmed. Check candidate status and
							reload configuration before deciding whether to retry. A request
							is never retried automatically.
						</p>
					)}
					<button
						type="button"
						disabled={
							busy ||
							flow !== null ||
							expired ||
							candidate.state !== "verified" ||
							!editable ||
							uncertain
						}
						onClick={() => setApproval(true)}
					>
						Review activation
					</button>
					<button
						type="button"
						className="ghost"
						disabled={busy}
						onClick={() =>
							void run(async () => {
								if (flow) await cancelBrowserAuthentication(flow);
								setFlow(null);
								// Expired candidates cannot be loaded by the BFF. They
								// expire on the server independently of this local draft.
								await discardCandidate(candidate.id).catch(() => {});
								setCandidate(null);
								setPreview(null);
								setDirty(false);
								await onReload();
							})
						}
					>
						Discard candidate and reload
					</button>
				</section>
			)}
			{!candidate && (
				<button
					type="button"
					className="ghost"
					disabled={busy}
					onClick={() => void run(onReload)}
				>
					Discard draft and reload
				</button>
			)}
			<CreateModal
				open={approval}
				title="Approve security activation"
				closeDisabled={busy}
				onClose={() => {
					if (approvalPassword.current) approvalPassword.current.value = "";
					setApproval(false);
				}}
			>
				{candidate && (
					<form
						className="stack"
						onSubmit={(event) => {
							event.preventDefault();
							const password = approvalPassword.current?.value ?? "";
							if (approvalPassword.current) approvalPassword.current.value = "";
							setApproval(false);
							void run(async () => {
								try {
									const result = await activateCandidate(
										candidate.id,
										candidate.base_revision,
										password,
									);
									if (result.group !== candidate.group)
										throw new Error(
											"Activation result could not be confirmed.",
										);
									setCandidate(null);
									setPreview(null);
									setDirty(false);
									onSaved(
										`Committed ${result.group} revision ${result.revision}. Reload to confirm this replica has applied it; other replicas reconcile independently.`,
									);
								} catch (caught) {
									setUncertain(true);

									throw caught;
								}
							});
						}}
					>
						<p>
							Activate {candidate.group} candidate{" "}
							<code style={{ overflowWrap: "anywhere" }}>{candidate.id}</code>{" "}
							against revision {candidate.base_revision}.
						</p>
						<ul>
							{summary.map((line) => (
								<li key={line}>{line}</li>
							))}
						</ul>
						<label className="stack" htmlFor={`${prefix}-approve-password`}>
							Local administrator password
							<input
								id={`${prefix}-approve-password`}
								ref={approvalPassword}
								type="password"
								autoComplete="current-password"
								required
							/>
						</label>
						<button disabled={busy || expired} type="submit">
							Approve and activate
						</button>
					</form>
				)}
			</CreateModal>
		</div>
	);
}
