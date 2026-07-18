"use client";

import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

export type GuidedFlowStep<StepId extends string> = {
	disabledHint?: string;
	enabled?: boolean;
	hint: string;
	id: StepId;
	label: string;
};

type GuidedFlowTabsProps<StepId extends string> = {
	activeStep: StepId;
	ariaLabel: string;
	className?: string;
	idPrefix?: string;
	numbered?: boolean;
	onChange: (step: StepId) => void;
	steps: readonly GuidedFlowStep<StepId>[];
};

type GuidedFlowStyle = CSSProperties & {
	"--guided-flow-columns": number;
};

export function GuidedFlowTabs<StepId extends string>({
	activeStep,
	ariaLabel,
	className,
	idPrefix = "guided-flow",
	numbered = true,
	onChange,
	steps,
}: GuidedFlowTabsProps<StepId>) {
	const availableSteps = steps.filter((step) => step.enabled !== false);

	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, stepId: StepId) {
		if (availableSteps.length === 0) return;

		const index = availableSteps.findIndex((step) => step.id === stepId);
		let nextIndex: number | null = null;
		if (event.key === "ArrowRight") {
			nextIndex = (index + 1) % availableSteps.length;
		}
		if (event.key === "ArrowLeft") {
			nextIndex = (index - 1 + availableSteps.length) % availableSteps.length;
		}
		if (event.key === "Home") nextIndex = 0;
		if (event.key === "End") nextIndex = availableSteps.length - 1;
		if (nextIndex == null) return;

		event.preventDefault();
		const nextStep = availableSteps[nextIndex];
		onChange(nextStep.id);
		window.setTimeout(
			() => document.getElementById(`${idPrefix}-tab-${nextStep.id}`)?.focus(),
			0,
		);
	}

	const style: GuidedFlowStyle = {
		"--guided-flow-columns": steps.length,
	};

	return (
		<div
			className={`export-template-editor-tabs guided-flow-tabs${className ? ` ${className}` : ""}`}
			role="tablist"
			aria-label={ariaLabel}
			style={style}
		>
			{steps.map((step, index) => {
				const enabled = step.enabled !== false;
				return (
					<button
						key={step.id}
						type="button"
						id={`${idPrefix}-tab-${step.id}`}
						role="tab"
						aria-selected={activeStep === step.id}
						aria-controls={`${idPrefix}-panel-${step.id}`}
						tabIndex={activeStep === step.id ? 0 : -1}
						className={activeStep === step.id ? "is-active" : ""}
						disabled={!enabled}
						onClick={() => onChange(step.id)}
						onKeyDown={(event) => onKeyDown(event, step.id)}
					>
						<span>
							{numbered ? `${index + 1}. ` : ""}
							{step.label}
						</span>
						<small>
							{enabled
								? step.hint
								: (step.disabledHint ?? "Complete the previous step")}
						</small>
					</button>
				);
			})}
		</div>
	);
}

type GuidedFlowContinueProps = {
	backLabel?: string;
	disabled?: boolean;
	nextLabel: string;
	onBack?: () => void;
	onContinue: () => void;
	summary: string;
	title: string;
};

export function GuidedFlowContinue({
	backLabel = "Back",
	disabled = false,
	nextLabel,
	onBack,
	onContinue,
	summary,
	title,
}: GuidedFlowContinueProps) {
	return (
		<div className="card export-target-continue-bar guided-flow-continue">
			<div className="stack action-card-header">
				<strong>{title}</strong>
				<span className="muted">{summary}</span>
			</div>
			<div className="action-row guided-flow-actions">
				{onBack ? (
					<button type="button" className="ghost" onClick={onBack}>
						{backLabel}
					</button>
				) : null}
				<button type="button" onClick={onContinue} disabled={disabled}>
					Continue to {nextLabel.toLocaleLowerCase()}
				</button>
			</div>
		</div>
	);
}

type GuidedFlowPanelProps = {
	children: ReactNode;
	className?: string;
	idPrefix?: string;
	stepId: string;
	tabIndex?: number;
};

export function GuidedFlowPanel({
	children,
	className = "stack",
	idPrefix = "guided-flow",
	stepId,
	tabIndex,
}: GuidedFlowPanelProps) {
	return (
		<div
			id={`${idPrefix}-panel-${stepId}`}
			className={`${className} guided-flow-panel`}
			role="tabpanel"
			aria-labelledby={`${idPrefix}-tab-${stepId}`}
			tabIndex={tabIndex}
		>
			{children}
		</div>
	);
}
