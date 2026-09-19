"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CreateModal } from "@/components/create-modal";
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

	useEffect(() => {
		const unregister = registerCredentialConfirmation((confirmation) => {
			if (pendingRef.current)
				return Promise.resolve(
					Response.json(
						{
							message:
								"Finish the current password confirmation, then retry this operation.",
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

	if (!pending) return null;
	return createPortal(
		<CreateModal
			open
			title="Confirm your password"
			closeDisabled={busy}
			onClose={() => pending.finish(null)}
		>
			<form
				className="stack"
				onSubmit={async (event) => {
					event.preventDefault();
					if (submitting.current || !passwordRef.current?.value) return;
					submitting.current = true;
					setBusy(true);
					setError(null);
					try {
						const submission = pending.submit(passwordRef.current.value);
						passwordRef.current.value = "";
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
								getApiErrorMessage(payload, "Password confirmation failed."),
							);
							window.requestAnimationFrame(() => passwordRef.current?.focus());
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
					The server requires your current password to approve this operation
					once.
				</p>
				<pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
					{pending.summary}
				</pre>
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
					<button type="submit" disabled={busy}>
						{busy ? "Confirming…" : "Confirm operation"}
					</button>
				</div>
			</form>
		</CreateModal>,
		document.body,
	);
}
