"use client";

import { useEffect, useState } from "react";

import type { ApiErrorResponse } from "@/lib/api/generated/models";
import {
	getLoginProviderOptions,
	normalizeAuthProvidersResponse,
	selectAvailableProvider,
} from "@/lib/auth-providers";
import {
	LOGIN_IDENTITY_SCOPE_STORAGE_KEY,
	LOCAL_IDENTITY_SCOPE,
	type ScopedLoginCredentials,
} from "@/lib/identity-scopes";

type ProviderDiscoveryState =
	| { status: "loading" }
	| { status: "available"; providers: string[] }
	| { status: "fallback" };

export function LoginForm({
	initialError = null,
}: {
	initialError?: string | null;
}) {
	const [identityScope, setIdentityScope] = useState("");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [providerDiscovery, setProviderDiscovery] =
		useState<ProviderDiscoveryState>({ status: "loading" });
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(initialError);

	useEffect(() => {
		const stored = window.localStorage.getItem(
			LOGIN_IDENTITY_SCOPE_STORAGE_KEY,
		);
		if (stored) setIdentityScope(stored);
	}, []);

	useEffect(() => {
		const controller = new AbortController();

		async function discoverProviders() {
			try {
				const response = await fetch("/_hubuum-bff/auth/providers", {
					signal: controller.signal,
					cache: "no-store",
				});
				if (!response.ok) throw new Error("Provider discovery failed.");
				const payload = normalizeAuthProvidersResponse(await response.json());
				if (!payload) throw new Error("Provider discovery was invalid.");

				const providers = getLoginProviderOptions(payload.providers);
				setProviderDiscovery({ status: "available", providers });
				setIdentityScope((current) =>
					selectAvailableProvider(providers, current),
				);
			} catch (caught) {
				if (caught instanceof DOMException && caught.name === "AbortError")
					return;
				setProviderDiscovery({ status: "fallback" });
			}
		}

		void discoverProviders();
		return () => controller.abort();
	}, []);

	async function submitLogin() {
		if (isSubmitting) {
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			const trimmedIdentityScope = identityScope.trim();
			const payload: ScopedLoginCredentials = {
				name: username,
				password,
				...(trimmedIdentityScope
					? { identity_scope: trimmedIdentityScope }
					: {}),
			};
			const response = await fetch("/_hubuum-bff/auth/login", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				let message = "Login failed";
				try {
					const errorPayload = (await response.json()) as ApiErrorResponse;
					message = errorPayload.message ?? message;
				} catch {
					// Keep default message.
				}
				throw new Error(message);
			}
			if (
				trimmedIdentityScope &&
				trimmedIdentityScope !== LOCAL_IDENTITY_SCOPE
			) {
				window.localStorage.setItem(
					LOGIN_IDENTITY_SCOPE_STORAGE_KEY,
					trimmedIdentityScope,
				);
			} else {
				window.localStorage.removeItem(LOGIN_IDENTITY_SCOPE_STORAGE_KEY);
			}

			window.location.assign("/app");
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unexpected error");
			setIsSubmitting(false);
		}
	}

	return (
		<form
			action="/_hubuum-bff/auth/login"
			aria-label="Login form"
			className="card login-card"
			method="post"
			onSubmit={(event) => {
				event.preventDefault();
				void submitLogin();
			}}
		>
			<div className="login-heading">
				<p className="eyebrow">Workspace access</p>
				<h1>Welcome back</h1>
				<p className="muted">Sign in to continue to your Hubuum workspace.</p>
			</div>

			{providerDiscovery.status === "available" ? (
				<>
					<label htmlFor="identity-scope">Authentication provider</label>
					<select
						id="identity-scope"
						name="identity_scope"
						value={identityScope}
						onChange={(event) => setIdentityScope(event.target.value)}
					>
						{providerDiscovery.providers.map((provider) => (
							<option key={provider} value={provider}>
								{provider === LOCAL_IDENTITY_SCOPE ? "Local account" : provider}
							</option>
						))}
					</select>
					<p className="muted login-field-hint">
						Choose the identity provider for this account.
					</p>
				</>
			) : (
				<>
					<label htmlFor="identity-scope">Identity scope</label>
					<input
						id="identity-scope"
						name="identity_scope"
						type="text"
						autoComplete="organization"
						placeholder="local"
						value={identityScope}
						onChange={(event) => setIdentityScope(event.target.value)}
						maxLength={160}
						spellCheck={false}
					/>
					<p className="muted login-field-hint">
						{providerDiscovery.status === "loading"
							? "Looking for configured providers. You can enter a scope manually."
							: "Leave blank for local accounts, or enter the configured provider scope."}
					</p>
				</>
			)}

			<label htmlFor="username">Username</label>
			<input
				id="username"
				name="username"
				type="text"
				autoComplete="username"
				placeholder="Enter your username"
				value={username}
				onChange={(event) => setUsername(event.target.value)}
				required
			/>

			<label htmlFor="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autoComplete="current-password"
				placeholder="Enter your password"
				value={password}
				onChange={(event) => setPassword(event.target.value)}
				required
			/>

			{error ? <div className="error-banner">{error}</div> : null}

			<button className="login-submit" type="submit" disabled={isSubmitting}>
				<span>{isSubmitting ? "Signing in..." : "Enter workspace"}</span>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M13.2 5.2 20 12l-6.8 6.8-1.4-1.4 4.4-4.4H4v-2h12.2l-4.4-4.4z" />
				</svg>
			</button>
		</form>
	);
}
