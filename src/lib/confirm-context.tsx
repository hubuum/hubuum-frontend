"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react";

import { useDialogAccessibility } from "@/lib/use-dialog-accessibility";

type ConfirmOptions = {
	title: string;
	description?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: "default" | "danger";
};

type PendingConfirm = ConfirmOptions & {
	resolve: (confirmed: boolean) => void;
};

type ConfirmContextValue = {
	confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(
		null,
	);

	const confirm = useCallback((options: ConfirmOptions) => {
		return new Promise<boolean>((resolve) => {
			setPendingConfirm({
				...options,
				resolve,
			});
		});
	}, []);

	const close = useCallback(
		(confirmed: boolean) => {
			if (!pendingConfirm) {
				return;
			}
			pendingConfirm.resolve(confirmed);
			setPendingConfirm(null);
		},
		[pendingConfirm],
	);

	const closeDialog = useCallback(() => close(false), [close]);
	useDialogAccessibility({
		open: pendingConfirm !== null,
		onClose: closeDialog,
		dialogRef,
		overlayRef,
		initialFocusSelector: "[data-dialog-initial-focus]",
	});

	return (
		<ConfirmContext.Provider value={{ confirm }}>
			{children}
			{pendingConfirm ? (
				<div className="modal-overlay" ref={overlayRef}>
					<button
						type="button"
						className="modal-backdrop"
						onClick={() => close(false)}
						aria-label="Cancel confirmation"
					/>
					<section
						ref={dialogRef}
						className="modal-panel card confirm-dialog"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="confirm-dialog-title"
						aria-describedby={
							pendingConfirm.description
								? "confirm-dialog-description"
								: undefined
						}
						tabIndex={-1}
					>
						<header className="modal-header">
							<h3 id="confirm-dialog-title">{pendingConfirm.title}</h3>
						</header>
						<div className="modal-content stack">
							{pendingConfirm.description ? (
								<p id="confirm-dialog-description" className="muted">
									{pendingConfirm.description}
								</p>
							) : null}
							<div className="form-actions form-actions--end">
								<button
									type="button"
									className="ghost"
									onClick={() => close(false)}
									data-dialog-initial-focus
								>
									{pendingConfirm.cancelLabel ?? "Cancel"}
								</button>
								<button
									type="button"
									className={pendingConfirm.tone === "danger" ? "danger" : ""}
									onClick={() => close(true)}
								>
									{pendingConfirm.confirmLabel ?? "Confirm"}
								</button>
							</div>
						</div>
					</section>
				</div>
			) : null}
		</ConfirmContext.Provider>
	);
}

export function useConfirm() {
	const context = useContext(ConfirmContext);
	if (!context) {
		throw new Error("useConfirm must be used within ConfirmProvider");
	}
	return context.confirm;
}
