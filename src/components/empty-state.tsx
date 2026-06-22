import type { ReactNode } from "react";

type EmptyStateProps = {
	title: string;
	description?: string;
	action?: ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
	return (
		<div className="empty-state empty-state--actionable">
			<div className="stack empty-state-copy">
				<strong>{title}</strong>
				{description ? <p>{description}</p> : null}
			</div>
			{action ? <div className="empty-state-action">{action}</div> : null}
		</div>
	);
}
