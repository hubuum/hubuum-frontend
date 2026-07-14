"use client";

import type { ReactNode } from "react";

type InlineFieldEditTriggerProps = {
	children: ReactNode;
	className?: string;
	disabled?: boolean;
	fieldLabel: string;
	onClick: () => void;
	valueText: string;
};

export function InlineFieldEditTrigger({
	children,
	className = "",
	disabled = false,
	fieldLabel,
	onClick,
	valueText,
}: InlineFieldEditTriggerProps) {
	return (
		<button
			type="button"
			className={`inline-field-edit-trigger${className ? ` ${className}` : ""}`}
			onClick={onClick}
			disabled={disabled}
			aria-label={`Edit ${fieldLabel}. Current value: ${valueText}`}
			title={`Edit ${fieldLabel}`}
		>
			<span className="inline-field-edit-trigger-value">{children}</span>
		</button>
	);
}
