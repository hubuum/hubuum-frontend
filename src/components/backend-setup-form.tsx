"use client";

import { useState } from "react";

import { getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import { SUPPORTED_SERVER_VERSION } from "@/lib/backend-setup";

export function BackendSetupForm() {
	const [url, setUrl] = useState("");
	const [key, setKey] = useState("");
	const [verified, setVerified] = useState<{
		origin: string;
		version: string;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			const response = await fetch(frontendApiPath("/setup"), {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"x-hubuum-setup-key": key,
				},
				body: JSON.stringify({ url, action: verified ? "save" : "check" }),
			});
			const data: unknown = await response.json();
			if (!response.ok) {
				throw new Error(
					getApiErrorMessage(data, "Setup could not be completed."),
				);
			}
			if (verified) {
				setKey("");
				window.location.assign("/login");
				return;
			}
			if (
				data &&
				typeof data === "object" &&
				"origin" in data &&
				typeof data.origin === "string" &&
				"version" in data &&
				typeof data.version === "string"
			) {
				setVerified({ origin: data.origin, version: data.version });
			} else {
				throw new Error("The server check returned an unexpected response.");
			}
		} catch (error) {
			setVerified(null);
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
			className="login-card card"
			aria-label="Backend setup"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
			aria-busy={busy}
		>
			<p className="muted">
				Connect this console to Hubuum Server. Everyone using this installation
				will share this connection.
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
					setError(null);
				}}
			/>
			<p id="backend-url-help" className="muted">
				Use an address reachable from this frontend, without /api/v1. Supports
				Hubuum Server v{SUPPORTED_SERVER_VERSION}.
			</p>
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
					setError(null);
				}}
			/>
			<p id="setup-key-help" className="muted">
				Use the setup key supplied by the person who started this frontend.
			</p>
			{error ? (
				<div className="error-banner" role="alert">
					{error}
				</div>
			) : null}
			{verified ? (
				<div role="status">
					<strong>Compatible server found</strong>
					<p>
						Hubuum Server {verified.version} at {verified.origin} is ready. Save
						this connection to continue to sign in.
					</p>
				</div>
			) : null}
			<button type="submit" className="login-submit" disabled={busy}>
				{busy
					? verified
						? "Saving connection…"
						: "Checking server…"
					: verified
						? "Save and continue"
						: "Check connection"}
			</button>
		</form>
	);
}
