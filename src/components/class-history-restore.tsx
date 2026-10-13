"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { HistoryComparison } from "@/components/history-comparison";
import type { HubuumClassHistory } from "@/lib/api/generated/models";
import {
	fetchHistoryLiveResource,
	restoreClassSnapshot,
	reviewClassRestore,
	type LiveHistoryResource,
} from "@/lib/api/resource-history";
import {
	CLASS_RESTORE_FIELDS,
	type HistoryScope,
} from "@/lib/resource-history";
import styles from "@/components/resource-history.module.css";

export function ClassHistoryRestore({
	scope,
	source,
	onClose,
	onRestored,
}: {
	scope: Extract<HistoryScope, { type: "class" }>;
	source: HubuumClassHistory;
	onClose: () => void;
	onRestored: () => void;
}) {
	const queryClient = useQueryClient();
	const [fields, setFields] = useState<string[]>([]);
	const [review, setReview] = useState<{
		live: LiveHistoryResource;
		plan: Awaited<ReturnType<typeof reviewClassRestore>>;
	} | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const reviewHeading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (review) reviewHeading.current?.focus();
	}, [review]);

	async function prepareReview() {
		setBusy(true);
		setError("");
		setReview(null);
		try {
			const live = await fetchHistoryLiveResource(scope);
			const plan = await reviewClassRestore(
				scope.classId,
				live,
				source,
				fields,
			);
			setReview({ live, plan });
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Could not prepare restoration.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function applyReview() {
		if (!review?.plan.changes.length || busy) return;
		setBusy(true);
		setError("");
		try {
			await restoreClassSnapshot(scope.classId, review.live, source, fields);
			for (const queryKey of [
				["class", scope.classId],
				["classes"],
				["history-browser", scope],
				["history-live", scope],
				["resource-history"],
				["resource-events"],
			])
				void queryClient.invalidateQueries({ queryKey });
			onRestored();
		} catch (failure) {
			setReview(null);
			setError(
				`${failure instanceof Error ? failure.message : "Restoration failed."} Fetch a fresh review before confirming again. If the response was lost, inspect live data before retrying.`,
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<CreateModal
			open
			title="Restore historical class fields"
			onClose={onClose}
			closeDisabled={busy}
			panelClassName={styles.restoreDialog}
		>
			<div className="stack">
				<p>
					Source: <strong>{source.name}</strong> · class #{source.id} · version
					#{source.history_id} ·{" "}
					<time dateTime={source.valid_from}>{source.valid_from}</time>
				</p>
				<p>Restore target: class #{scope.classId}</p>
				<p>
					Restore selected names, descriptions, and collection assignments as a
					new audited update. Objects, relationships, and computed values are
					not restored.
				</p>
				<p className="muted">
					Schema and validation restoration require staged analysis and
					activation on populated classes. Atomic restoration and source audit
					provenance are{" "}
					<a href="https://github.com/hubuum/hubuum-frontend/issues/149">
						blocked on server support
					</a>
					.
				</p>
				{error ? (
					<p role="alert" className="error-banner">
						{error}
					</p>
				) : null}
				{busy ? (
					<p role="status">
						{review
							? "Restoring reviewed fields…"
							: "Loading current class and checking the selection…"}
					</p>
				) : null}
				{review ? (
					<>
						<h4 ref={reviewHeading} tabIndex={-1}>
							Review changes
						</h4>
						<p>
							Live revision: {review.live.revision}. Selected fields:{" "}
							{fields.join(", ")}.
						</p>
						<HistoryComparison
							before={review.plan.before}
							after={review.plan.proposed}
							baselineLabel="Current live"
							selectedLabel="Proposed result"
							onlyChanges
						/>
						<p>
							All selected fields apply together against this revision. The
							server checks current permissions, including access to the
							destination collection. A conflict or rejected change applies
							nothing.
						</p>
						{!review.plan.changes.length ? (
							<p role="status">
								The selected values already match. No update is needed.
							</p>
						) : null}
					</>
				) : (
					<fieldset className={styles.restoreChoices} disabled={busy}>
						<legend>Class fields to restore</legend>
						{CLASS_RESTORE_FIELDS.map((field) => (
							<label className={styles.choice} key={field}>
								<input
									type="checkbox"
									checked={fields.includes(field)}
									onChange={(event) =>
										setFields((current) =>
											event.target.checked
												? [...current, field]
												: current.filter((value) => value !== field),
										)
									}
								/>
								<code>{field}</code>
							</label>
						))}
						<label className={styles.choice}>
							<input type="checkbox" disabled />
							Schema and validation (blocked)
						</label>
					</fieldset>
				)}
				<div className="action-row">
					<button
						type="button"
						className="secondary"
						disabled={busy}
						onClick={onClose}
					>
						Cancel
					</button>
					{review ? (
						<>
							<button
								type="button"
								className="secondary"
								disabled={busy}
								onClick={() => setReview(null)}
							>
								Change selection
							</button>
							<button
								type="button"
								disabled={busy || !review.plan.changes.length}
								onClick={() => void applyReview()}
							>
								Restore {fields.length} selected class fields
							</button>
						</>
					) : (
						<button
							type="button"
							disabled={busy || !fields.length}
							onClick={() => void prepareReview()}
						>
							Review selected fields
						</button>
					)}
				</div>
			</div>
		</CreateModal>
	);
}
