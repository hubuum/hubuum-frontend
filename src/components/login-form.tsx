"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ApiErrorResponse, LoginUser } from "@/lib/api/generated/models";

export function LoginForm() {
	const router = useRouter();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function submitLogin() {
		if (isSubmitting) {
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			const payload: LoginUser = { name: username, password };
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

			router.push("/app");
			router.refresh();
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
