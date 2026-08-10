"use client";

import { useQuery } from "@tanstack/react-query";
import { FormEvent, type ReactNode, useMemo, useState } from "react";
import { EventDetailsModal } from "@/components/event-details-modal";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	fetchAuditCollections,
	fetchEventsPage,
	type EventRecord,
} from "@/lib/api/events";
import type { Collection } from "@/lib/api/generated/models";
import {
	type AuditDrilldownDimension,
	type AuditFilterDraft,
	type AuditFilterField,
	buildAuditEventFilters,
	clearAuditFilter,
	EMPTY_AUDIT_FILTER_DRAFT,
	getAuditDrilldownDraft,
} from "@/lib/audit-filters";
import {
	buildCollectionHierarchy,
	formatCollectionOption,
} from "@/lib/collection-hierarchy";
import {
	EVENT_ACTIONS,
	EVENT_ACTOR_KINDS,
	EVENT_ENTITY_TYPES,
} from "@/lib/event-options";
import {
	formatEventActor,
	formatEventInitiator,
	getProvenanceTaskId,
} from "@/lib/event-provenance";
import type { TableExportColumn, TableExportView } from "@/lib/table-export";

type ActiveAuditFilter = {
	field: AuditFilterField;
	label: string;
};

function formatTimestamp(value: string | null | undefined): string {
	if (!value) {
		return "n/a";
	}

	try {
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(new Date(value));
	} catch {
		return value;
	}
}

function formatEntity(event: EventRecord): string {
	return `${event.entity_type}${
		event.entity_id == null ? "" : ` #${event.entity_id}`
	}${event.entity_name ? ` / ${event.entity_name}` : ""}`;
}

function formatEntityReference(event: EventRecord): string {
	const entityType = event.entity_type
		.replaceAll("_", " ")
		.replace(/^./, (character) => character.toUpperCase());
	return `${entityType}${event.entity_id == null ? "" : ` #${event.entity_id}`}`;
}

function formatCollection(
	collectionId: number | null | undefined,
	collectionsById: ReadonlyMap<number, Collection>,
): string {
	if (collectionId == null) {
		return "n/a";
	}

	const collection = collectionsById.get(collectionId);
	if (!collection) {
		return `Collection #${collectionId}`;
	}

	return formatCollectionOption(collection, collectionsById);
}

function getEventExportColumns(
	collectionsById: ReadonlyMap<number, Collection>,
): TableExportColumn<EventRecord>[] {
	return [
		{
			key: "time",
			label: "Time",
			getValue: (event) => formatTimestamp(event.occurred_at),
		},
		{
			key: "entity",
			label: "Entity",
			getValue: formatEntity,
		},
		{ key: "action", label: "Action", getValue: (event) => event.action },
		{
			key: "actor",
			label: "Actor",
			getValue: formatEventActor,
		},
		{
			key: "initiator",
			label: "Initiator",
			getValue: formatEventInitiator,
		},
		{
			key: "task",
			label: "Root task",
			getValue: (event) => getProvenanceTaskId(event),
		},
		{
			key: "collection",
			label: "Collection",
			getValue: (event) => {
				const collection =
					event.collection_id == null
						? undefined
						: collectionsById.get(event.collection_id);
				const label = formatCollection(event.collection_id, collectionsById);
				return collection?.description
					? `${label} — ${collection.description}`
					: label;
			},
		},
		{ key: "summary", label: "Summary", getValue: (event) => event.summary },
		{
			key: "correlation",
			label: "Correlation",
			getValue: (event) => event.correlation_id ?? "n/a",
		},
	];
}

function mergeEventOptions(
	knownOptions: readonly string[],
	observedOptions: readonly string[],
	selectedOptions: readonly string[],
): string[] {
	const known = new Set(knownOptions);
	const additions = Array.from(
		new Set(
			[...observedOptions, ...selectedOptions].map((value) => value.trim()),
		),
	)
		.filter((value) => value && !known.has(value))
		.sort((left, right) => left.localeCompare(right));
	return [...knownOptions, ...additions];
}

function getActiveAuditFilters(
	draft: AuditFilterDraft,
	collectionsById: ReadonlyMap<number, Collection>,
): ActiveAuditFilter[] {
	const filters: ActiveAuditFilter[] = [];
	if (draft.entityType) {
		filters.push({
			field: "entityType",
			label: `Entity · ${draft.entityType}`,
		});
	}
	if (draft.entityId) {
		filters.push({ field: "entityId", label: `Entity ID · ${draft.entityId}` });
	}
	if (draft.action) {
		filters.push({ field: "action", label: `Action · ${draft.action}` });
	}
	if (draft.actorKind) {
		filters.push({ field: "actorKind", label: `Actor · ${draft.actorKind}` });
	}
	if (draft.actorUserId) {
		filters.push({
			field: "actorUserId",
			label: `Actor ID · ${draft.actorUserId}`,
		});
	}
	if (draft.initiatorUserId) {
		filters.push({
			field: "initiatorUserId",
			label: `Initiator ID · ${draft.initiatorUserId}`,
		});
	}
	if (draft.collectionId) {
		const collectionId = Number.parseInt(draft.collectionId, 10);
		filters.push({
			field: "collectionId",
			label: `Collection · ${formatCollection(collectionId, collectionsById)}`,
		});
	}
	if (draft.occurredAfter) {
		filters.push({
			field: "occurredAfter",
			label: `After · ${draft.occurredAfter}`,
		});
	}
	if (draft.occurredBefore) {
		filters.push({
			field: "occurredBefore",
			label: `Before · ${draft.occurredBefore}`,
		});
	}
	return filters;
}

function DrilldownButton({
	ariaLabel,
	children,
	onDrilldown,
	title,
}: {
	ariaLabel: string;
	children: ReactNode;
	onDrilldown: () => void;
	title?: string;
}) {
	return (
		<button
			type="button"
			className="audit-drilldown-button"
			aria-label={ariaLabel}
			title={title ?? "Add this value to the active filters"}
			onClick={(event) => {
				event.stopPropagation();
				onDrilldown();
			}}
		>
			{children}
		</button>
	);
}

export function AuditWorkspace() {
	const [selectedEvent, setSelectedEvent] = useState<EventRecord | null>(null);
	const [cursor, setCursor] = useState("");
	const [draft, setDraft] = useState<AuditFilterDraft>(
		EMPTY_AUDIT_FILTER_DRAFT,
	);
	const [appliedDraft, setAppliedDraft] = useState<AuditFilterDraft>(
		EMPTY_AUDIT_FILTER_DRAFT,
	);
	const filters = useMemo(
		() => buildAuditEventFilters(appliedDraft),
		[appliedDraft],
	);

	const eventsQuery = useQuery({
		queryKey: ["events", "audit-workspace", filters, cursor],
		queryFn: () =>
			fetchEventsPage({
				...filters,
				cursor: cursor || undefined,
			}),
	});
	const collectionsQuery = useQuery({
		queryKey: ["collections", "audit-workspace"],
		queryFn: fetchAuditCollections,
	});
	const collectionHierarchy = useMemo(
		() => buildCollectionHierarchy(collectionsQuery.data ?? []),
		[collectionsQuery.data],
	);
	const collectionsById = collectionHierarchy.byId;
	const events = eventsQuery.data?.items ?? [];
	const entityTypeOptions = useMemo(
		() =>
			mergeEventOptions(
				EVENT_ENTITY_TYPES,
				events.map((event) => event.entity_type),
				[draft.entityType, appliedDraft.entityType],
			),
		[appliedDraft.entityType, draft.entityType, events],
	);
	const actionOptions = useMemo(
		() =>
			mergeEventOptions(
				EVENT_ACTIONS,
				events.map((event) => event.action),
				[draft.action, appliedDraft.action],
			),
		[appliedDraft.action, draft.action, events],
	);
	const actorKindOptions = useMemo(
		() =>
			mergeEventOptions(
				EVENT_ACTOR_KINDS,
				events.map(
					(event) => event.provenance.actor.kind?.trim() || event.actor_kind,
				),
				[draft.actorKind, appliedDraft.actorKind],
			),
		[appliedDraft.actorKind, draft.actorKind, events],
	);
	const activeFilters = useMemo(
		() => getActiveAuditFilters(appliedDraft, collectionsById),
		[appliedDraft, collectionsById],
	);
	const eventExportColumns = useMemo(
		() => getEventExportColumns(collectionsById),
		[collectionsById],
	);

	function patchDraft(field: AuditFilterField, value: string) {
		setDraft((current) => ({ ...current, [field]: value }));
	}

	function applyDraft(nextDraft: AuditFilterDraft) {
		setCursor("");
		setDraft(nextDraft);
		setAppliedDraft(nextDraft);
	}

	function onFilterSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		applyDraft(draft);
	}

	function clearFilters() {
		applyDraft(EMPTY_AUDIT_FILTER_DRAFT);
	}

	function removeFilter(field: AuditFilterField) {
		applyDraft(clearAuditFilter(appliedDraft, field));
	}

	function drillInto(event: EventRecord, dimension: AuditDrilldownDimension) {
		const nextDraft = getAuditDrilldownDraft(appliedDraft, event, dimension);
		if (nextDraft) {
			setSelectedEvent(null);
			applyDraft(nextDraft);
		}
	}

	const eventExportView: TableExportView<EventRecord> = {
		id: "audit.events",
		fileName: "audit-events-view",
		sheetName: "Audit events",
		columns: eventExportColumns,
		rows: events,
	};
	const selectedEventIndex = selectedEvent
		? events.findIndex((event) => event.id === selectedEvent.id)
		: -1;

	return (
		<section className="stack audit-workspace">
			<EventDetailsModal
				event={selectedEvent}
				onClose={() => setSelectedEvent(null)}
				navigation={
					selectedEventIndex >= 0
						? {
								current: selectedEventIndex + 1,
								itemLabel: "audit event",
								onPrevious:
									selectedEventIndex > 0
										? () => setSelectedEvent(events[selectedEventIndex - 1])
										: undefined,
								onNext:
									selectedEventIndex < events.length - 1
										? () => setSelectedEvent(events[selectedEventIndex + 1])
										: undefined,
								total: events.length,
							}
						: undefined
				}
			/>
			<header className="stack action-card-header audit-page-header">
				<h2>Event stream</h2>
				<p className="muted">
					Explore visible audit events, then select an entity, action, actor, or
					collection in the table to progressively narrow the dataset. Results
					remain scoped by your account and collection permissions.
				</p>
			</header>

			<article className="card stack panel-card audit-filter-card">
				<div className="audit-filter-header">
					<div className="stack action-card-header">
						<h3>Refine events</h3>
						<p className="muted">
							Choose known values from the menus or enter an exact resource ID.
						</p>
					</div>
					<span className="status-pill audit-filter-count">
						{activeFilters.length} active
					</span>
				</div>

				<form className="audit-filter-form" onSubmit={onFilterSubmit}>
					<fieldset className="audit-filter-group">
						<legend>What happened</legend>
						<div className="audit-filter-fields">
							<label className="control-field">
								<span>Entity type</span>
								<select
									value={draft.entityType}
									onChange={(event) =>
										patchDraft("entityType", event.target.value)
									}
								>
									<option value="">Any entity type</option>
									{entityTypeOptions.map((entityType) => (
										<option key={entityType} value={entityType}>
											{entityType}
										</option>
									))}
								</select>
							</label>
							<label className="control-field">
								<span>Entity ID</span>
								<input
									type="number"
									min="1"
									step="1"
									value={draft.entityId}
									onChange={(event) =>
										patchDraft("entityId", event.target.value)
									}
									placeholder="Any ID"
								/>
							</label>
							<label className="control-field">
								<span>Action</span>
								<select
									value={draft.action}
									onChange={(event) => patchDraft("action", event.target.value)}
								>
									<option value="">Any action</option>
									{actionOptions.map((action) => (
										<option key={action} value={action}>
											{action}
										</option>
									))}
								</select>
							</label>
						</div>
					</fieldset>

					<fieldset className="audit-filter-group">
						<legend>Who</legend>
						<div className="audit-filter-fields">
							<label className="control-field">
								<span>Actor kind</span>
								<select
									value={draft.actorKind}
									onChange={(event) =>
										patchDraft("actorKind", event.target.value)
									}
								>
									<option value="">Any actor kind</option>
									{actorKindOptions.map((actorKind) => (
										<option key={actorKind} value={actorKind}>
											{actorKind}
										</option>
									))}
								</select>
							</label>
							<label className="control-field">
								<span>Actor ID</span>
								<input
									type="number"
									min="1"
									step="1"
									value={draft.actorUserId}
									onChange={(event) =>
										patchDraft("actorUserId", event.target.value)
									}
									placeholder="Any actor"
								/>
							</label>
							<label className="control-field">
								<span>Initiator ID</span>
								<input
									type="number"
									min="1"
									step="1"
									value={draft.initiatorUserId}
									onChange={(event) =>
										patchDraft("initiatorUserId", event.target.value)
									}
									placeholder="Any initiator"
								/>
							</label>
						</div>
					</fieldset>

					<fieldset className="audit-filter-group audit-filter-group--wide">
						<legend>Where and when</legend>
						<div className="audit-filter-fields audit-filter-fields--scope">
							<label className="control-field audit-collection-field">
								<span>Collection</span>
								<select
									value={draft.collectionId}
									disabled={collectionsQuery.isLoading}
									onChange={(event) =>
										patchDraft("collectionId", event.target.value)
									}
								>
									<option value="">
										{collectionsQuery.isLoading
											? "Loading collections…"
											: "All visible collections"}
									</option>
									{draft.collectionId &&
									!collectionsById.has(Number(draft.collectionId)) ? (
										<option value={draft.collectionId}>
											Collection #{draft.collectionId}
										</option>
									) : null}
									{collectionHierarchy.flatNodes.map(({ collection }) => (
										<option key={collection.id} value={collection.id}>
											{formatCollectionOption(collection, collectionsById)}
										</option>
									))}
								</select>
							</label>
							<label className="control-field">
								<span>After</span>
								<input
									type="date"
									value={draft.occurredAfter}
									onChange={(event) =>
										patchDraft("occurredAfter", event.target.value)
									}
								/>
							</label>
							<label className="control-field">
								<span>Before</span>
								<input
									type="date"
									value={draft.occurredBefore}
									onChange={(event) =>
										patchDraft("occurredBefore", event.target.value)
									}
								/>
							</label>
						</div>
					</fieldset>

					<div className="audit-filter-actions">
						<button type="submit">Apply filters</button>
						<button type="button" className="ghost" onClick={clearFilters}>
							Clear all
						</button>
					</div>
				</form>

				{collectionsQuery.isError ? (
					<div className="error-banner">
						Collection names could not be loaded. Event IDs remain available.
					</div>
				) : null}

				<div className="audit-active-filters" aria-live="polite">
					<div>
						<strong>Active filters</strong>
						<span className="muted">
							Select a value in the table to add another.
						</span>
					</div>
					{activeFilters.length ? (
						<div className="audit-filter-chips">
							{activeFilters.map((filter) => (
								<button
									key={filter.field}
									type="button"
									className="audit-filter-chip"
									aria-label={`Remove ${filter.label} filter`}
									onClick={() => removeFilter(filter.field)}
								>
									<span>{filter.label}</span>
									<span aria-hidden="true">×</span>
								</button>
							))}
						</div>
					) : (
						<span className="muted">No filters applied.</span>
					)}
				</div>
			</article>

			<article className="card stack panel-card audit-results-card">
				<div className="panel-header audit-results-header">
					<div className="stack action-card-header">
						<h3>Events</h3>
						<p className="muted">
							{eventsQuery.data?.totalCount == null
								? "Newest visible audit events."
								: `${eventsQuery.data.totalCount} matching events.`}
							{eventsQuery.isFetching && !eventsQuery.isLoading
								? " Updating…"
								: ""}
						</p>
					</div>
					<div className="action-row">
						<TableExportMenu
							view={eventExportView}
							disabled={eventsQuery.isFetching}
							compact
						/>
						<button
							type="button"
							className="secondary"
							disabled={!cursor || eventsQuery.isFetching}
							onClick={() => setCursor("")}
						>
							First page
						</button>
						<button
							type="button"
							className="secondary"
							disabled={!eventsQuery.data?.nextCursor || eventsQuery.isFetching}
							onClick={() => setCursor(eventsQuery.data?.nextCursor ?? "")}
						>
							Next page
						</button>
					</div>
				</div>

				<p className="audit-drilldown-hint muted">
					Highlighted values add filters. Select the rest of a row to inspect
					the complete event.
				</p>

				{eventsQuery.isLoading ? (
					<div className="muted">Loading events...</div>
				) : null}
				{eventsQuery.isError ? (
					<div className="error-banner">
						Failed to load events.{" "}
						{eventsQuery.error instanceof Error
							? eventsQuery.error.message
							: "Unknown error"}
					</div>
				) : null}
				{!eventsQuery.isLoading &&
				!eventsQuery.isError &&
				(eventsQuery.data?.items.length ?? 0) === 0 ? (
					<div className="empty-state">No events match these filters.</div>
				) : null}
				{events.length ? (
					<div className="table-wrap audit-table-wrap">
						<table>
							<thead>
								<tr>
									<th>Time</th>
									<th>Entity</th>
									<th>Action</th>
									<th>Actor</th>
									<th>Initiator</th>
									<th>Collection</th>
									<th>Summary</th>
								</tr>
							</thead>
							<tbody>
								{events.map((event) => {
									const collection =
										event.collection_id == null
											? undefined
											: collectionsById.get(event.collection_id);
									const actor = formatEventActor(event);
									const initiator = formatEventInitiator(event);
									return (
										<tr
											key={event.id}
											className="activity-detail-row"
											tabIndex={0}
											onClick={() => setSelectedEvent(event)}
											onKeyDown={(keyboardEvent) => {
												if (
													keyboardEvent.target ===
														keyboardEvent.currentTarget &&
													(keyboardEvent.key === "Enter" ||
														keyboardEvent.key === " ")
												) {
													keyboardEvent.preventDefault();
													setSelectedEvent(event);
												}
											}}
											aria-label={`View details for event ${event.event_id}`}
										>
											<td className="audit-time-cell">
												{formatTimestamp(event.occurred_at)}
											</td>
											<td>
												<DrilldownButton
													ariaLabel={`Drill down to entity ${formatEntity(event)}`}
													onDrilldown={() => drillInto(event, "entity")}
													title={`${formatEntityReference(event)} · Add this entity to the active filters`}
												>
													<span className="audit-cell-primary">
														{event.entity_name || formatEntityReference(event)}
													</span>
												</DrilldownButton>
											</td>
											<td>
												<DrilldownButton
													ariaLabel={`Drill down to action ${event.action}`}
													onDrilldown={() => drillInto(event, "action")}
												>
													<span className="audit-action-value">
														{event.action}
													</span>
												</DrilldownButton>
											</td>
											<td>
												<DrilldownButton
													ariaLabel={`Drill down to actor ${actor}`}
													onDrilldown={() => drillInto(event, "actor")}
												>
													{actor}
												</DrilldownButton>
											</td>
											<td>
												{event.provenance.initiator ? (
													<DrilldownButton
														ariaLabel={`Drill down to initiator ${initiator}`}
														onDrilldown={() => drillInto(event, "initiator")}
													>
														{initiator}
													</DrilldownButton>
												) : (
													initiator
												)}
											</td>
											<td>
												{event.collection_id == null ? (
													"n/a"
												) : (
													<DrilldownButton
														ariaLabel={`Drill down to collection ${formatCollection(
															event.collection_id,
															collectionsById,
														)}`}
														onDrilldown={() => drillInto(event, "collection")}
														title={`${formatCollection(
															event.collection_id,
															collectionsById,
														)}${collection?.description ? ` · ${collection.description}` : ""} · Add this collection to the active filters`}
													>
														<span className="audit-cell-primary">
															{collection?.name ?? "Collection"} #
															{event.collection_id}
														</span>
													</DrilldownButton>
												)}
											</td>
											<td className="audit-summary-cell">
												<span className="audit-summary-text">
													{event.summary}
												</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : null}
			</article>
		</section>
	);
}
