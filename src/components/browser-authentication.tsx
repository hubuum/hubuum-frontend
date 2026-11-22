"use client";

import { useEffect, useRef, useState } from "react";
import {
	type BrowserAuthenticationFlow,
	cancelBrowserAuthentication,
	waitForBrowserAuthentication,
} from "@/lib/browser-authentication";

export function BrowserAuthentication({
	flow,
	onComplete,
	onCancel,
	signal,
}: {
	flow: BrowserAuthenticationFlow;
	onComplete: (result: unknown) => void;
	onCancel: () => void;
	signal?: AbortSignal;
}) {
	const callbacks = useRef({ onComplete, onCancel });
	callbacks.current = { onComplete, onCancel };
	const [error, setError] = useState<string | null>(null);
	const [cancelling, setCancelling] = useState(false);
	const [copied, setCopied] = useState(false);
	const stopped = useRef(false);
	useEffect(() => {
		const controller = new AbortController();
		const abandon = () => {
			if (stopped.current) return;
			stopped.current = true;
			void cancelBrowserAuthentication(flow).catch(() => {});
		};
		window.addEventListener("pagehide", abandon);
		signal?.addEventListener("abort", abandon, { once: true });
		void waitForBrowserAuthentication(flow, controller.signal)
			.then((result) => {
				if (!controller.signal.aborted && !stopped.current) {
					stopped.current = true;
					callbacks.current.onComplete(result);
				}
			})
			.catch((caught) => {
				if (!controller.signal.aborted && !stopped.current) {
					setError(
						caught instanceof Error
							? caught.message
							: "Authentication could not be confirmed.",
					);
				}
			});
		return () => {
			controller.abort();
			window.removeEventListener("pagehide", abandon);
			signal?.removeEventListener("abort", abandon);
		};
	}, [flow, signal]);
	return (
		<section className="stack" aria-label="Browser authentication">
			<p>
				Enter this code on the Hubuum authentication page, sign in, then review
				and approve this request.
			</p>
			<p>
				<strong>
					Verification code:{" "}
					<code style={{ overflowWrap: "anywhere" }}>
						{flow.next.user_code}
					</code>
				</strong>
			</p>
			<button
				type="button"
				className="ghost"
				onClick={async () => {
					try {
						await navigator.clipboard.writeText(flow.next.user_code);
						setCopied(true);
					} catch {
						setCopied(false);
					}
				}}
			>
				{copied ? "Code copied" : "Copy verification code"}
			</button>
			<a
				style={{ textDecoration: "underline" }}
				href={flow.next.verification_uri}
				target="_blank"
				rel="noopener noreferrer"
			>
				Open authentication page
			</a>
			<p className="muted" role="status">
				{error
					? "Authentication stopped."
					: "Waiting for your approval in the other tab…"}
			</p>
			<p className="muted">
				This request expires at {new Date(flow.expires_at).toLocaleTimeString()}
				. Keep this tab open.
			</p>
			{error && (
				<p className="error-banner" role="alert">
					{error}
				</p>
			)}
			{error && (
				<button
					type="button"
					className="ghost"
					onClick={() => {
						stopped.current = true;
						callbacks.current.onCancel();
					}}
				>
					Close without retrying
				</button>
			)}
			<button
				type="button"
				className="ghost"
				disabled={cancelling}
				onClick={async () => {
					stopped.current = true;
					setCancelling(true);
					try {
						await cancelBrowserAuthentication(flow);
						callbacks.current.onCancel();
					} catch (caught) {
						setError(
							caught instanceof Error
								? caught.message
								: "Cancellation could not be confirmed. Inspect the request before retrying.",
						);
						setCancelling(false);
					}
				}}
			>
				{cancelling ? "Cancelling…" : "Cancel authentication"}
			</button>
		</section>
	);
}
