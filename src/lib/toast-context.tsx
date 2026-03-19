"use client";

import {
	createContext,
	ReactNode,
	useCallback,
	useContext,
	useState,
} from "react";

type ToastType = "success" | "error" | "info";

type Toast = {
	id: string;
	message: string;
	type: ToastType;
};

type ToastContextValue = {
	showToast: (message: string, type?: ToastType) => void;
	toasts: Toast[];
	removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

let toastIdCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const showToast = useCallback((message: string, type: ToastType = "info") => {
		const id = `toast-${++toastIdCounter}`;
		const toast: Toast = { id, message, type };

		setToasts((current) => [...current, toast]);

		// Auto-dismiss after 4 seconds
		setTimeout(() => {
			setToasts((current) => current.filter((t) => t.id !== id));
		}, 4000);
	}, []);

	const removeToast = useCallback((id: string) => {
		setToasts((current) => current.filter((t) => t.id !== id));
	}, []);

	return (
		<ToastContext.Provider value={{ showToast, toasts, removeToast }}>
			{children}
		</ToastContext.Provider>
	);
}

export function useToast() {
	const context = useContext(ToastContext);
	if (!context) {
		throw new Error("useToast must be used within ToastProvider");
	}
	return context;
}
