"use client";

import type { ReactNode } from "react";

import {
	type CreateSection,
	OPEN_CREATE_EVENT,
} from "@/lib/create-events";

type ResourceIndexHeadingProps = {
	context?: ReactNode;
	createLabel: string;
	createSection: CreateSection;
	summary: readonly string[];
	title: string;
};

function IconPlus() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M19 11H13V5h-2v6H5v2h6v6h2v-6h6z" fill="currentColor" />
		</svg>
	);
}

export function ResourceIndexHeading({
	context,
	createLabel,
	createSection,
	summary,
	title,
}: ResourceIndexHeadingProps) {
	function openCreateModal() {
		window.dispatchEvent(
			new CustomEvent(OPEN_CREATE_EVENT, {
				detail: { section: createSection },
			}),
		);
	}

	return (
		<div className="resource-index-heading">
			<h2>{title}</h2>
			{context}
			{summary.length ? (
				<span className="resource-index-summary" aria-live="polite">
					<span className="sr-only">{summary.join(", ")}</span>
					{summary.map((segment) => (
						<span
							aria-hidden="true"
							className="resource-index-summary-item"
							key={segment}
						>
							{segment}
						</span>
					))}
				</span>
			) : null}
			<button
				type="button"
				className="create-button resource-index-create"
				onClick={openCreateModal}
				aria-label={createLabel}
				title={createLabel}
			>
				<IconPlus />
				<span className="create-button-text">{createLabel}</span>
			</button>
		</div>
	);
}
