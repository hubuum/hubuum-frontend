"use client";

import { useEffect, useRef, useState } from "react";

import { BrowserAuthentication } from "@/components/browser-authentication";
import {
	beginBrowserAuthentication,
	discoverBrowserAuthentication,
	type BrowserAuthenticationFlow,
	type BrowserAuthenticationMethod,
	authenticationMessage,
} from "@/lib/browser-authentication";

import type { ApiErrorResponse } from "@/lib/api/generated/models";
import {
	getLoginProviderOptions,
	normalizeAuthProvidersResponse,
	selectAvailableProvider,
} from "@/lib/auth-providers";
import {
	LOCAL_IDENTITY_SCOPE,
	LOGIN_IDENTITY_SCOPE_STORAGE_KEY,
	type ScopedLoginCredentials,
} from "@/lib/identity-scopes";

type ProviderDiscoveryState =
	| { status: "loading" }
	| {
			status: "available";
			providers: string[];
			methods?: BrowserAuthenticationMethod[];
	  }
	| { status: "fallback" }
	| { status: "unavailable" }
	| { status: "local_recovery" };

export function LoginForm({
	initialError = null,
	returnTo = "/app",
}: {
	initialError?: string | null;
	returnTo?: string;
}) {
	const [identityScope, setIdentityScope] = useState("");
	const [username, setUsername] = useState("");
	const passwordRef = useRef<HTMLInputElement>(null);
	const [flow, setFlow] = useState<BrowserAuthenticationFlow | null>(null);
	const [showPassword, setShowPassword] = useState(false);
	const [providerDiscovery, setProviderDiscovery] =
		useState<ProviderDiscoveryState>({ status: "loading" });
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(initialError);
	const loginEndpoint =
		returnTo === "/app"
			? "/_hubuum-bff/auth/login"
			: `/_hubuum-bff/auth/login?next=${encodeURIComponent(returnTo)}`;

	useEffect(() => {
		const stored = window.localStorage.getItem(
			LOGIN_IDENTITY_SCOPE_STORAGE_KEY,
		);
		if (stored) setIdentityScope(stored);
	}, []);

	useEffect(() => {
		const controller = new AbortController();

		async function discoverProviders() {
			let legacy = false;
			try {
				const methods = await discoverBrowserAuthentication(controller.signal);
				if (methods !== null) {
					setProviderDiscovery({
						status: "available",
						providers: methods.map((method) => method.provider_id),
						methods,
					});
					setIdentityScope(
						(current) =>
							methods.find(
								(method) =>
									method.provider_id === current || method.name === current,
							)?.provider_id ?? (current && current !== "local" ? "" : "local"),
					);
					return;
				}
				legacy = true;
				const response = await fetch("/_hubuum-bff/auth/providers", {
					signal: controller.signal,
					cache: "no-store",
				});
				if (!response.ok) {
					setProviderDiscovery({ status: "fallback" });
					return;
				}
				const payload = normalizeAuthProvidersResponse(await response.json());
				if (!payload) {
					setProviderDiscovery({ status: "fallback" });
					return;
				}

				const providers = getLoginProviderOptions(payload.providers);
				setProviderDiscovery({ status: "available", providers });
				setIdentityScope((current) =>
					selectAvailableProvider(providers, current),
				);
			} catch (caught) {
				if (caught instanceof DOMException && caught.name === "AbortError")
					return;
				setProviderDiscovery({ status: legacy ? "fallback" : "unavailable" });
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
			const selected =
				providerDiscovery.status === "available"
					? providerDiscovery.methods?.find(
							(method) => method.provider_id === identityScope,
						)
					: undefined;
			if (selected?.interaction === "browser") {
				if (!selected.browser_available)
					throw new Error(authenticationMessage("provider_unavailable"));
				setFlow(
					await beginBrowserAuthentication({
						provider_id: selected.provider_id,
						purpose: "login",
						return_path: returnTo,
					}),
				);
				return;
			}
			if (
				providerDiscovery.status === "unavailable" ||
				providerDiscovery.status === "loading"
			)
				throw new Error(
					"Choose local recovery explicitly, or retry provider discovery.",
				);
			const trimmedIdentityScope =
				providerDiscovery.status === "local_recovery"
					? "local"
					: selected?.kind === "local"
						? "local"
						: (selected?.name ?? identityScope.trim());
			const payload: ScopedLoginCredentials = {
				name: username,
				password: passwordRef.current?.value ?? "",
				...(trimmedIdentityScope
					? { identity_scope: trimmedIdentityScope }
					: {}),
			};
			const requestBody = JSON.stringify(payload);
			if (passwordRef.current) passwordRef.current.value = "";
			const response = await fetch(loginEndpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: requestBody,
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

			window.location.assign(returnTo);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Unexpected error");
			setIsSubmitting(false);
		}
	}

	const selectedMethod =
		providerDiscovery.status === "available"
			? providerDiscovery.methods?.find(
					(method) => method.provider_id === identityScope,
				)
			: undefined;
	const browserSelected = selectedMethod?.interaction === "browser";
	const methodMissing =
		providerDiscovery.status === "available" &&
		Boolean(providerDiscovery.methods) &&
		!selectedMethod;
	const passwordVisible =
		!browserSelected &&
		!methodMissing &&
		providerDiscovery.status !== "unavailable" &&
		providerDiscovery.status !== "loading";
	if (flow)
		return (
			<div className="card login-card">
				<BrowserAuthentication
					flow={flow}
					onComplete={(result) => {
						if (
							result &&
							typeof result === "object" &&
							"authenticated" in result &&
							result.authenticated === true
						)
							window.location.assign(returnTo);
						else {
							setError(
								authenticationMessage(
									result && typeof result === "object" && "body" in result
										? result.body
										: result,
								),
							);
							setFlow(null);
							setIsSubmitting(false);
						}
					}}
					onCancel={() => {
						setFlow(null);
						setIsSubmitting(false);
					}}
				/>
			</div>
		);
	const providerOptions =
		providerDiscovery.status === "available"
			? providerDiscovery.providers
			: [LOCAL_IDENTITY_SCOPE];
	const selectedProvider =
		providerDiscovery.status === "available"
			? identityScope
			: LOCAL_IDENTITY_SCOPE;

	return (
		<form
			action={loginEndpoint}
			aria-label="Login form"
			data-provider-discovery={providerDiscovery.status}
			className="card login-card"
			method="post"
			onSubmit={(event) => {
				event.preventDefault();
				void submitLogin();
			}}
		>
			{providerDiscovery.status === "available" &&
			providerOptions.length === 1 &&
			!methodMissing ? (
				<input
					id="identity-scope"
					type="hidden"
					name="identity_scope"
					value={selectedProvider}
				/>
			) : providerDiscovery.status !== "fallback" &&
				providerDiscovery.status !== "local_recovery" &&
				providerDiscovery.status !== "unavailable" ? (
				<>
					<label htmlFor="identity-scope">Authentication provider</label>
					<select
						id="identity-scope"
						name="identity_scope"
						value={selectedProvider}
						onChange={(event) => {
							if (passwordRef.current) passwordRef.current.value = "";
							setIdentityScope(event.target.value);
						}}
					>
						{methodMissing && (
							<option value="" disabled>
								Choose a provider
							</option>
						)}
						{providerOptions.map((provider) => (
							<option key={provider} value={provider}>
								{provider === LOCAL_IDENTITY_SCOPE
									? "Local account"
									: providerDiscovery.status === "available"
										? (providerDiscovery.methods?.find(
												(method) => method.provider_id === provider,
											)?.name ?? provider)
										: provider}
							</option>
						))}
					</select>
					<p className="muted login-field-hint">
						{providerDiscovery.status === "loading"
							? "Looking for configured authentication providers."
							: "Choose the identity provider for this account."}
					</p>
				</>
			) : providerDiscovery.status === "fallback" ? (
				<>
					<label htmlFor="identity-scope">Identity scope</label>
					<input
						id="identity-scope"
						name="identity_scope"
						type="text"
						autoComplete="organization"
						placeholder="local"
						value={identityScope}
						onChange={(event) => {
							if (passwordRef.current) passwordRef.current.value = "";
							setIdentityScope(event.target.value);
						}}
						maxLength={160}
						spellCheck={false}
					/>
					<p className="muted login-field-hint">
						Leave blank for local accounts, or enter the configured provider
						scope.
					</p>
				</>
			) : null}
			{providerDiscovery.status === "unavailable" && (
				<div className="stack">
					<p role="alert">
						Provider discovery is unavailable. External sign-in requires working
						discovery.
					</p>
					<button
						type="button"
						className="ghost"
						onClick={() => {
							setIdentityScope("local");
							setProviderDiscovery({ status: "local_recovery" });
						}}
					>
						Use local recovery account
					</button>
					<button
						type="button"
						className="ghost"
						onClick={() => window.location.reload()}
					>
						Retry discovery
					</button>
				</div>
			)}
			{providerDiscovery.status === "local_recovery" && (
				<p className="muted">Local recovery uses local accounts only.</p>
			)}
			{methodMissing && (
				<p role="alert">
					The previous provider is unavailable. Choose a provider explicitly to
					continue.
				</p>
			)}
			{browserSelected && !selectedMethod?.browser_available && (
				<p role="alert">
					This provider is unavailable. Reload discovery or choose another
					configured provider.
				</p>
			)}
			{passwordVisible && (
				<>
					<label htmlFor="username">Username</label>
					<input
						id="username"
						name="username"
						type="text"
						autoComplete="username"
						autoCapitalize="none"
						spellCheck={false}
						placeholder="Enter your username"
						value={username}
						onChange={(event) => setUsername(event.target.value)}
						required
					/>

					<label htmlFor="password">Password</label>
					<div className="login-password-field">
						<input
							id="password"
							name="password"
							type={showPassword ? "text" : "password"}
							autoComplete="current-password"
							placeholder="Enter your password"
							ref={passwordRef}
							required
						/>

						<button
							type="button"
							className="login-password-toggle"
							aria-label={showPassword ? "Hide password" : "Show password"}
							title={showPassword ? "Hide password" : "Show password"}
							aria-controls="password"
							aria-pressed={showPassword}
							onClick={() => setShowPassword((current) => !current)}
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								strokeLinejoin="round"
								aria-hidden="true"
							>
								<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
								<circle cx="12" cy="12" r="3" />
								{showPassword ? <path d="m3 3 18 18" /> : null}
							</svg>
						</button>
					</div>
				</>
			)}
			{browserSelected && (
				<p className="muted">
					Continue in the server authentication page. Hubuum will ask you to
					review and approve sign-in.
				</p>
			)}
			{error ? (
				<div className="error-banner" role="alert">
					{error}
				</div>
			) : null}

			<button
				className="login-submit"
				type="submit"
				disabled={
					methodMissing ||
					isSubmitting ||
					providerDiscovery.status === "loading" ||
					providerDiscovery.status === "unavailable" ||
					(browserSelected && !selectedMethod?.browser_available)
				}
			>
				<span>
					{isSubmitting
						? "Signing in..."
						: browserSelected
							? `Continue with ${selectedMethod?.name}`
							: "Enter workspace"}
				</span>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M13.2 5.2 20 12l-6.8 6.8-1.4-1.4 4.4-4.4H4v-2h12.2l-4.4-4.4z" />
				</svg>
			</button>
		</form>
	);
}
