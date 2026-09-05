"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Toast, useToast } from "@/lib/toast-context";

function ToastMessage({
	toast,
	removeToast,
}: {
	toast: Toast;
	removeToast: (id: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	useEffect(() => {
		if (toast.type === "error" || toast.action || hovered || focused) return;
		const timer = window.setTimeout(() => removeToast(toast.id), 6000);
		return () => window.clearTimeout(timer);
	}, [toast, hovered, focused, removeToast]);
	return (
		<output
			className={`toast toast--${toast.type}`}
			aria-live={toast.type === "error" ? "assertive" : "polite"}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onFocusCapture={() => setFocused(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget))
					setFocused(false);
			}}
		>
			<div className="toast-message">
				{toast.action ? (
					<Link
						href={toast.action.href}
						className="toast-link"
						onClick={() => removeToast(toast.id)}
					>
						{toast.message}
					</Link>
				) : (
					toast.message
				)}
			</div>
			<button
				type="button"
				className="toast-close"
				aria-label="Dismiss notification"
				onClick={() => removeToast(toast.id)}
			>
				×
			</button>
		</output>
	);
}

export function ToastContainer() {
	const { toasts, removeToast } = useToast();

	if (toasts.length === 0) {
		return null;
	}

	return (
		<div className="toast-container">
			{toasts.map((toast) => (
				<ToastMessage key={toast.id} toast={toast} removeToast={removeToast} />
			))}
		</div>
	);
}
