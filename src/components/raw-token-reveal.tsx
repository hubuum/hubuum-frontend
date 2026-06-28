"use client";

import { useState } from "react";

type RawTokenRevealProps = {
	token: string;
	onDismiss: () => void;
};

export function RawTokenReveal({ token, onDismiss }: RawTokenRevealProps) {
	const [copied, setCopied] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div className="card stack token-reveal">
			<h4>Token created</h4>
			<p className="warning-banner">
				Copy this token now — it is shown only once and cannot be retrieved
				again.
			</p>
			<code className="token-value">{token}</code>
			<div className="form-actions">
				<button type="button" onClick={copy}>
					{copied ? "Copied" : "Copy token"}
				</button>
				<button type="button" className="ghost" onClick={onDismiss}>
					Done
				</button>
			</div>
		</div>
	);
}
