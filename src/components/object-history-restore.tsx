"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { HistoryComparison } from "@/components/history-comparison";
import type { HistoryRecord } from "@/lib/api/events";
import {
	canRestoreObject,
	fetchHistoryLiveResource,
	restoreObjectSnapshot,
} from "@/lib/api/resource-history";
import {
	buildObjectRestore,
	type HistoryScope,
	restoreChoices,
} from "@/lib/resource-history";
import styles from "@/components/resource-history.module.css";

export function ObjectHistoryRestore({
	scope,
	source,
	isAdmin,
	onClose,
	onRestored,
}: {
	scope: Extract<HistoryScope, { type: "object" }>;
	source: HistoryRecord & { data: unknown };
	isAdmin: boolean;
	onClose: () => void;
	onRestored: () => void;
}) {
	const queryClient = useQueryClient();
	const [paths, setPaths] = useState<string[]>([]);
	const [reviewing, setReviewing] = useState(false);
	const reviewHeading = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (reviewing) reviewHeading.current?.focus();
	}, [reviewing]);
	const review = useQuery({
		queryKey: [
			"history-restore-review",
			scope.classId,
			scope.objectId,
			source.history_id,
		],
		queryFn: async () => {
			const live = await fetchHistoryLiveResource(scope);
			if (
				!live.object ||
				!(await canRestoreObject(live.object.collection_id, isAdmin))
			)
				throw new Error(
					"You do not have permission to update this live object.",
				);
			return live;
		},
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: false,
	});
	const choices = useMemo(
		() =>
			review.data?.object
				? restoreChoices(review.data.object.data, source.data)
				: [],
		[review.data, source.data],
	);
	const plan = useMemo(
		() =>
			review.data?.object
				? buildObjectRestore(review.data.object.data, source.data, paths)
				: null,
		[review.data, source.data, paths],
	);
	const mutation = useMutation({
		mutationFn: async () => {
			if (!review.data || !reviewing || !plan?.changes.length)
				throw new Error("Review the current changes before restoring.");
			return restoreObjectSnapshot(scope, review.data, source.data, paths);
		},
		retry: false,
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: ["object", scope.classId, scope.objectId],
				}),
				queryClient.invalidateQueries({ queryKey: ["objects"] }),
				queryClient.invalidateQueries({
					queryKey: ["class-object-samples", scope.classId],
				}),
				queryClient.invalidateQueries({
					queryKey: ["object-aggregates", scope.classId],
				}),
				queryClient.invalidateQueries({ queryKey: ["history-browser", scope] }),
				queryClient.invalidateQueries({ queryKey: ["history-live", scope] }),
				queryClient.invalidateQueries({ queryKey: ["resource-history"] }),
				queryClient.invalidateQueries({ queryKey: ["resource-events"] }),
			]);
			onRestored();
		},
	});
	function refreshReview() {
		setPaths([]);
		setReviewing(false);
		mutation.reset();
		void review.refetch();
	}
	return (
		<CreateModal
			open
			title={
				reviewing
					? "Review restoration to live"
					: "Restore historical object data"
			}
			onClose={onClose}
			closeDisabled={mutation.isPending}
			panelClassName={styles.restoreDialog}
		>
			<div className="stack">
				<p>
					Source: <strong>{source.name}</strong> · version #{source.history_id}{" "}
					· <time dateTime={source.valid_from}>{source.valid_from}</time>
				</p>
				<p className="muted">
					This creates a new update to the live object's data. Restoring a
					subtree also removes keys that were absent in the source. Arrays are
					restored as whole values.
				</p>
				{review.isFetching ? (
					<p role="status">Loading current data and permissions…</p>
				) : null}
				{review.isError ? (
					<p role="alert" className="error-banner">
						{review.error.message}
					</p>
				) : null}
				{mutation.isError ? (
					<div role="alert" className="error-banner">
						<p>{mutation.error.message}</p>
						<button type="button" className="secondary" onClick={refreshReview}>
							Refresh and review again
						</button>
					</div>
				) : null}
				{review.data && !review.isFetching && !review.isError ? (
					<>
						<p>Live revision: {review.data.revision ?? "unavailable"}</p>
						{!reviewing ? (
							<fieldset
								className={styles.restoreChoices}
								disabled={mutation.isPending || mutation.isError}
							>
								<legend>Keys or scopes to restore</legend>
								{choices.length ? (
									choices.map((choice) => (
										<label key={choice.path} className={styles.choice}>
											<input
												type="checkbox"
												checked={paths.includes(choice.path)}
												onChange={(event) =>
													setPaths((current) =>
														event.target.checked
															? [...current, choice.path]
															: current.filter((path) => path !== choice.path),
													)
												}
											/>
											<code>{choice.path || "Entire data document"}</code>
										</label>
									))
								) : (
									<p>The live data already matches this snapshot.</p>
								)}
							</fieldset>
						) : plan ? (
							<>
								<h4 ref={reviewHeading} tabIndex={-1}>
									Review changes
								</h4>
								<HistoryComparison
									before={review.data.object?.data}
									after={plan.proposed}
									baselineLabel="Current live"
									selectedLabel="Proposed result"
									onlyChanges
								/>
							</>
						) : null}
						{reviewing ? (
							<p className="muted">
								This creates an audited update. The audit trail does not record
								which historical snapshot was used.
							</p>
						) : null}
						<div className="action-row">
							<button
								type="button"
								className="secondary"
								disabled={mutation.isPending}
								onClick={onClose}
							>
								Cancel
							</button>
							{reviewing ? (
								<>
									<button
										type="button"
										className="secondary"
										disabled={mutation.isPending || mutation.isError}
										onClick={() => setReviewing(false)}
									>
										Change selection
									</button>
									<button
										type="button"
										disabled={
											mutation.isPending ||
											mutation.isError ||
											!plan?.changes.length
										}
										onClick={() => mutation.mutate()}
									>
										{mutation.isPending
											? "Restoring…"
											: paths.includes("")
												? "Restore entire data document to live"
												: "Restore selected values to live"}
									</button>
								</>
							) : (
								<button
									type="button"
									disabled={!plan?.changes.length || mutation.isError}
									onClick={() => setReviewing(true)}
								>
									Review {plan?.changes.length ?? 0} changes
								</button>
							)}
						</div>
					</>
				) : null}
			</div>
		</CreateModal>
	);
}
