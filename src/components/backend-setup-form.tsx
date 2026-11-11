"use client";

import { useState } from "react";

import { getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import {
	backendCheckSchema,
	type BackendCheck,
	SUPPORTED_SERVER_VERSION,
} from "@/lib/backend-setup";
import { clearUserSettingsForLogout } from "@/lib/user-settings-client";

export function BackendSetupForm({
	expectedRevision,
}: {
	expectedRevision?: string;
} = {}) {
	const changing = expectedRevision !== undefined;
	const [url, setUrl] = useState("");
	const [key, setKey] = useState("");
	const [verified, setVerified] = useState<BackendCheck | null>(null);
	const [acceptWarnings, setAcceptWarnings] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			const response = await fetch(
				frontendApiPath(changing ? "/connection" : "/setup"),
				{
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
						...(changing ? {} : { "x-hubuum-setup-key": key }),
					},
					body: JSON.stringify({
						url,
						action: verified ? "save" : "check",
						confirmation: acceptWarnings ? verified : undefined,
						expectedRevision,
					}),
				},
			);
			const data: unknown = await response.json();
			const result = backendCheckSchema.safeParse(data);
			if (!response.ok) {
				setVerified(
					response.status === 409 && result.success ? result.data : null,
				);
				setAcceptWarnings(false);
				setError(getApiErrorMessage(data, "Setup could not be completed."));
				return;
			}
			if (verified) {
				setKey("");
				clearUserSettingsForLogout();
				window.location.assign("/login");
				return;
			}
			if (result.success) {
				setVerified(result.data);
				setAcceptWarnings(false);
			} else {
				throw new Error("The server check returned an unexpected response.");
			}
		} catch (error) {
			setVerified(null);
			setAcceptWarnings(false);
			setError(
				error instanceof Error
					? error.message
					: "Setup could not be completed. Try again.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<form
			className={`${changing ? "stack card" : "login-card card"} backend-setup-form`}
			aria-label={changing ? "Change server connection" : "Backend setup"}
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			aria-busy={busy}
		>
			<p className="muted">
				{changing
					? "Changing this connection affects everyone using this console. All users will need to sign in again on the new server."
					: "Connect this console to Hubuum Server. Everyone using this installation will share this connection."}
			</p>
			<label htmlFor="backend-url">Server URL</label>
			<input
				id="backend-url"
				name="backend-url"
				type="url"
				required
				maxLength={2048}
				autoComplete="url"
				autoCapitalize="none"
				spellCheck={false}
				placeholder="https://hubuum.example.com"
				value={url}
				disabled={busy}
				aria-describedby="backend-url-help"
				onChange={(event) => {
					setUrl(event.target.value);
					setVerified(null);
					setAcceptWarnings(false);
					setError(null);
				}}
			/>
			<p id="backend-url-help" className="muted">
				Use an address reachable from this frontend, without /api/v1. Tested
				with Hubuum Server v{SUPPORTED_SERVER_VERSION}; other versions require
				confirmation.
			</p>
			{!changing ? (
				<>
					<label htmlFor="setup-key">Setup key</label>
					<input
						id="setup-key"
						name="setup-key"
						type="password"
						required
						minLength={32}
						maxLength={256}
						autoComplete="off"
						value={key}
						disabled={busy}
						aria-describedby="setup-key-help"
						onChange={(event) => {
							setKey(event.target.value);
							setVerified(null);
							setAcceptWarnings(false);
							setError(null);
						}}
					/>
					<p id="setup-key-help" className="muted">
						Find the one-time key in the frontend startup output, or use the key
						supplied by your installation operator.
					</p>
				</>
			) : null}
			{error ? (
				<div className="error-banner" role="alert">
					{error}
				</div>
			) : null}
			{verified ? (
				<>
					<div role="status">
						<strong>
							{verified.compatibility === "supported"
								? "Compatible server found"
								: verified.compatibility === "incompatible"
									? "Known compatibility problems"
									: "Compatibility not verified"}
						</strong>
						<p>
							Hubuum Server at {verified.origin}.{" "}
							{verified.version
								? `Reported version: ${verified.version}.`
								: "Version not reported."}
						</p>
						{verified.warnings.length ? (
							<ul>
								{verified.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						) : null}
					</div>
					{changing || verified.compatibility !== "supported" ? (
						<label className="checkbox-row">
							<input
								type="checkbox"
								checked={acceptWarnings}
								disabled={busy}
								onChange={(event) => setAcceptWarnings(event.target.checked)}
							/>
							{changing
								? "I have reviewed the server check and want to switch this console for everyone, requiring all users to sign in again."
								: "I understand these compatibility warnings and want to continue anyway."}
						</label>
					) : null}
				</>
			) : null}
			<button
				type="submit"
				className={changing ? "button" : "login-submit"}
				disabled={
					busy ||
					(verified !== null &&
						(changing || verified.compatibility !== "supported") &&
						!acceptWarnings)
				}
			>
				{busy
					? verified
						? "Saving connection…"
						: "Checking server…"
					: verified
						? changing
							? "Switch server and sign out"
							: verified.compatibility === "supported"
								? "Save and continue"
								: "Save and continue anyway"
						: "Check connection"}
			</button>
		</form>
	);
}
