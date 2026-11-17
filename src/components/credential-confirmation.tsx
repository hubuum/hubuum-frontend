"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CreateModal } from "@/components/create-modal";
import { BrowserAuthentication } from "@/components/browser-authentication";
import {
	approvalAuthenticationMethod,
	type BrowserAuthenticationFlow,
	type BrowserAuthenticationMethod,
} from "@/lib/browser-authentication";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	type CredentialConfirmation,
	registerCredentialConfirmation,
} from "@/lib/credential-approval-client";
import { isRecord } from "@/lib/credential-operation";

type PendingConfirmation = CredentialConfirmation & {
	finish: (response: Response | null) => void;
};

export function CredentialConfirmationDialog() {
	const [pending, setPending] = useState<PendingConfirmation | null>(null);
	const pendingRef = useRef<PendingConfirmation | null>(null);
	const passwordRef = useRef<HTMLInputElement | null>(null);
	const submitting = useRef(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [method, setMethod] = useState<BrowserAuthenticationMethod | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const [flow, setFlow] = useState<BrowserAuthenticationFlow | null>(null);
	const [unavailable, setUnavailable] = useState(false);

	useEffect(() => {
		const unregister = registerCredentialConfirmation((confirmation) => {
			if (pendingRef.current)
				return Promise.resolve(
					Response.json(
						{
							message:
								"Finish the current authentication request, then retry this operation.",
						},
						{ status: 409 },
					),
				);
			return new Promise((resolve) => {
				const abort = () => next.finish(null);
				const next: PendingConfirmation = {
					...confirmation,
					finish: (response) => {
						confirmation.signal.removeEventListener("abort", abort);
						if (pendingRef.current !== next) return;
						if (passwordRef.current) passwordRef.current.value = "";
						pendingRef.current = null;
						setPending(null);
						resolve(response);
					},
				};
				pendingRef.current = next;
				setFlow(null);
				setLoading(true);
				setUnavailable(false);
				setMethod(null);
				setError(null);
				setPending(next);
				confirmation.signal.addEventListener("abort", abort, { once: true });
				if (confirmation.signal.aborted) abort();
			});
		});
		return () => {
			unregister();
			pendingRef.current?.finish(null);
		};
	}, []);
	useEffect(() => {
		if (!pending) return;
		const controller = new AbortController();
		setLoading(true);
		setUnavailable(false);
		setMethod(null);
		void approvalAuthenticationMethod(controller.signal)
			.then((selected) => {
				if (!controller.signal.aborted) setMethod(selected);
			})
			.catch((caught) => {
				if (!controller.signal.aborted) {
					setUnavailable(true);
					setError(
						caught instanceof Error
							? caught.message
							: "Authentication capabilities are unavailable.",
					);
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [pending]);
	useEffect(() => {
		if (
			pending &&
			!loading &&
			!unavailable &&
			!flow &&
			method?.interaction !== "browser"
		)
			passwordRef.current?.focus();
	}, [pending, loading, unavailable, flow, method]);

	if (!pending) return null;
	return createPortal(
		<CreateModal
			open
			title={
				method?.interaction === "browser" || loading || unavailable
					? "Approve this operation"
					: "Confirm your password"
			}
			closeDisabled={busy || Boolean(flow)}
			onClose={() => {
				if (!flow) pending.finish(null);
			}}
		>
			<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
				{pending.summary}
			</pre>
			{flow ? (
				<BrowserAuthentication
					flow={flow}
					signal={pending.signal}
					onCancel={() => pending.finish(null)}
					onComplete={(result) => {
						if (
							isRecord(result) &&
							typeof result.status === "number" &&
							Number.isInteger(result.status) &&
							result.status >= 200 &&
							result.status <= 599
						)
							pending.finish(
								new Response(
									[204, 205].includes(result.status)
										? null
										: JSON.stringify(result.body),
									{
										status: result.status,
										headers: { "Content-Type": "application/json" },
									},
								),
							);
						else
							pending.finish(
								Response.json(
									{
										message:
											"The operation could not be confirmed. Inspect its current state before retrying.",
									},
									{ status: 502 },
								),
							);
					}}
				/>
			) : (
				<>
					{loading && (
						<p role="status">
							Checking your account's authentication capabilities…
						</p>
					)}
					<form
						className="stack"
						onSubmit={async (event) => {
							event.preventDefault();
							if (
								submitting.current ||
								loading ||
								unavailable ||
								(method?.interaction !== "browser" &&
									!passwordRef.current?.value)
							)
								return;
							submitting.current = true;
							setBusy(true);
							setError(null);
							try {
								if (method?.interaction === "browser") {
									setFlow(await pending.begin(method.provider_id));
									return;
								}
								const input = passwordRef.current;
								if (!input?.value) return;
								const submission = pending.submit(input.value);
								input.value = "";
								const response = await submission;
								const payload: unknown =
									response.status === 403
										? await response
												.clone()
												.json()
												.catch(() => null)
										: null;
								if (
									isRecord(payload) &&
									payload.reason === "password_confirmation_failed"
								) {
									setError(
										getApiErrorMessage(
											payload,
											"Password confirmation failed.",
										),
									);
									window.requestAnimationFrame(() =>
										passwordRef.current?.focus(),
									);
								} else {
									pending.finish(response);
								}
							} catch {
								pending.finish(
									Response.json(
										{
											message:
												"The result could not be confirmed. Check the affected account, task, or restore status before retrying.",
										},
										{ status: 502 },
									),
								);
							} finally {
								submitting.current = false;
								setBusy(false);
							}
						}}
					>
						<p>
							{loading
								? "The server selects the supported authentication method for your account."
								: unavailable
									? "Use a supported account to approve this operation."
									: method?.interaction === "browser"
										? "Authenticate as the same account in Hubuum's authentication page and approve this exact operation once."
										: "The server requires your current password to approve this operation once."}
						</p>
						{!loading && !unavailable && method?.interaction !== "browser" && (
							<label className="control-field">
								<span>Your current password</span>
								<input
									ref={passwordRef}
									type="password"
									autoComplete="current-password"
									required
									disabled={busy}
								/>
							</label>
						)}
						{error ? (
							<div className="error-banner" role="alert">
								{error}
							</div>
						) : null}
						<div className="form-actions">
							<button
								type="button"
								className="ghost"
								disabled={busy}
								onClick={() => pending.finish(null)}
							>
								Cancel
							</button>
							<button type="submit" disabled={busy || loading || unavailable}>
								{busy
									? "Confirming…"
									: method?.interaction === "browser"
										? `Continue with ${method.name}`
										: "Confirm operation"}
							</button>
						</div>
					</form>
				</>
			)}
		</CreateModal>,
		document.body,
	);
}
