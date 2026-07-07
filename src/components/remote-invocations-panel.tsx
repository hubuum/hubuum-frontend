"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
	RemoteInvocationSubject,
	RemoteTarget,
	RemoteTargetSubjectType,
} from "@/lib/api/generated/models";
import {
	fetchRemoteTargetsPage,
	filterInvokableTargets,
	invokeRemoteTarget,
	parseJsonObjectInput,
} from "@/lib/api/remote-targets";
import { useToast } from "@/lib/toast-context";

type RemoteInvocationsPanelProps = {
	collectionId: number;
	subject: RemoteInvocationSubject;
	subjectLabel: string;
	subjectType: RemoteTargetSubjectType;
	targetClassId?: number;
};

type DraftState = {
	bodyOverrideInput: string;
	error: string | null;
	isExpanded: boolean;
	parametersInput: string;
};

const emptyDraft: DraftState = {
	bodyOverrideInput: "{}",
	error: null,
	isExpanded: false,
	parametersInput: "{}",
};

function formatMethod(value: string): string {
	return value.toUpperCase();
}

function makeIdempotencyKey(targetId: number): string {
	const random =
		typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return `remote-target-${targetId}-${random}`;
}

export function RemoteInvocationsPanel({
	collectionId,
	subject,
	subjectLabel,
	subjectType,
	targetClassId,
}: RemoteInvocationsPanelProps) {
	const { showToast } = useToast();
	const [targets, setTargets] = useState<RemoteTarget[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [loadError, setLoadError] = useState<string | null>(null);
	const [drafts, setDrafts] = useState<Record<number, DraftState>>({});
	const reloadKey = `${collectionId}:${subjectType}`;

	const loadMutation = useMutation({
		mutationFn: async (cursor?: string | null) =>
			fetchRemoteTargetsPage({
				cursor: cursor ?? undefined,
				limit: 100,
				collectionId,
			}),
		onSuccess: (page, cursor) => {
			setTargets((current) => (cursor ? [...current, ...page.targets] : page.targets));
			setNextCursor(page.nextCursor);
			setLoadError(null);
		},
		onError: (error) => {
			setLoadError(
				error instanceof Error ? error.message : "Failed to load remote targets.",
			);
		},
	});

	const invokeMutation = useMutation({
		mutationFn: async ({
			bodyOverride,
			parameters,
			target,
		}: {
			bodyOverride: Record<string, unknown>;
			parameters: Record<string, unknown>;
			target: RemoteTarget;
		}) =>
			invokeRemoteTarget(
				target.id,
				{ bodyOverride, parameters, subject },
				makeIdempotencyKey(target.id),
			),
		onSuccess: (task, variables) => {
			showToast(
				`Queued ${variables.target.name} as task #${task.id}`,
				"success",
				{ href: `/tasks/${task.id}` },
			);
		},
		onError: (error, variables) => {
			setDrafts((current) => ({
				...current,
				[variables.target.id]: {
					...(current[variables.target.id] ?? emptyDraft),
					error:
						error instanceof Error
							? error.message
							: "Failed to invoke remote target.",
				},
			}));
		},
	});

	useEffect(() => {
		if (!reloadKey) {
			return;
		}
		setTargets([]);
		setNextCursor(null);
		setDrafts({});
		loadMutation.mutate(null);
	}, [reloadKey, loadMutation.mutate]);

	const invokableTargets = useMemo(
		() => filterInvokableTargets(targets, collectionId, subjectType, targetClassId),
		[collectionId, subjectType, targetClassId, targets],
	);
	const visibleTargets = useMemo(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) {
			return invokableTargets;
		}

		return invokableTargets.filter((target) =>
			[target.name, target.description, target.method]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [invokableTargets, search]);

	function updateDraft(targetId: number, update: Partial<DraftState>) {
		setDrafts((current) => ({
			...current,
			[targetId]: {
				...(current[targetId] ?? emptyDraft),
				...update,
			},
		}));
	}

	function onInvoke(target: RemoteTarget) {
		const draft = drafts[target.id] ?? emptyDraft;
		let parameters: Record<string, unknown>;
		let bodyOverride: Record<string, unknown>;

		try {
			parameters = parseJsonObjectInput(draft.parametersInput, "Parameters");
			bodyOverride = parseJsonObjectInput(
				draft.bodyOverrideInput,
				"Body override",
			);
		} catch (error) {
			updateDraft(target.id, {
				error: error instanceof Error ? error.message : "Invalid invocation JSON.",
			});
			return;
		}

		updateDraft(target.id, { error: null });
		invokeMutation.mutate({ bodyOverride, parameters, target });
	}

	return (
		<section className="card stack panel-card">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h3>Remote invocations</h3>
					<p className="muted">
						Call configured remote targets for {subjectLabel}.
					</p>
				</div>
				<div className="action-row">
					<span className="muted">{invokableTargets.length} available</span>
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search invocations"
					/>
				</div>
			</div>

			{loadMutation.isPending && targets.length === 0 ? (
				<div className="muted">Loading remote invocations...</div>
			) : null}
			{loadError ? <div className="error-banner">{loadError}</div> : null}

			{!loadMutation.isPending && !loadError && visibleTargets.length === 0 ? (
				<div className="empty-state">
					No remote invocations are available for this resource.
				</div>
			) : null}

			{visibleTargets.length > 0 ? (
				<div className="template-list">
					{visibleTargets.map((target) => {
						const draft = drafts[target.id] ?? emptyDraft;
						const isInvoking =
							invokeMutation.isPending &&
							invokeMutation.variables?.target.id === target.id;

						return (
							<article key={target.id} className="template-card">
								<div className="template-card-header">
									<div>
										<h4>{target.name}</h4>
										<p className="muted">{target.description}</p>
									</div>
									<div className="preview-meta">
										<span>{formatMethod(target.method)}</span>
										<span>#{target.id}</span>
									</div>
								</div>

								{draft.isExpanded ? (
									<div className="form-grid">
										<label className="control-field control-field--wide">
											<span>Parameters JSON</span>
											<textarea
												rows={4}
												value={draft.parametersInput}
												onChange={(event) =>
													updateDraft(target.id, {
														error: null,
														parametersInput: event.target.value,
													})
												}
											/>
										</label>
										<label className="control-field control-field--wide">
											<span>Body override JSON</span>
											<textarea
												rows={4}
												value={draft.bodyOverrideInput}
												onChange={(event) =>
													updateDraft(target.id, {
														bodyOverrideInput: event.target.value,
														error: null,
													})
												}
											/>
										</label>
									</div>
								) : null}

								{draft.error ? (
									<div className="error-banner">{draft.error}</div>
								) : null}

								<div className="action-row">
									<button
										type="button"
										onClick={() => onInvoke(target)}
										disabled={isInvoking}
									>
										{isInvoking ? "Calling..." : "Call"}
									</button>
									<button
										type="button"
										className="ghost"
										onClick={() =>
											updateDraft(target.id, {
												isExpanded: !draft.isExpanded,
												error: null,
											})
										}
									>
										{draft.isExpanded ? "Hide payload" : "Payload"}
									</button>
									<Link className="link-chip" href="/tasks">
										Tasks
									</Link>
								</div>
							</article>
						);
					})}
				</div>
			) : null}

			{nextCursor ? (
				<div className="form-actions">
					<button
						type="button"
						className="ghost"
						onClick={() => loadMutation.mutate(nextCursor)}
						disabled={loadMutation.isPending}
					>
						{loadMutation.isPending ? "Loading..." : "Load more"}
					</button>
				</div>
			) : null}
		</section>
	);
}
