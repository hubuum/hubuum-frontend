"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
	GuidedFlowContinue,
	GuidedFlowPanel,
	GuidedFlowTabs,
} from "@/components/guided-flow";
import { JsonViewer } from "@/components/json-viewer";
import { TableExportMenu } from "@/components/table-export-menu";
import {
	createCollectionEventSubscription,
	deleteCollectionEventSubscription,
	fetchEventSinks,
	fetchCollectionEventSubscriptions,
	updateCollectionEventSubscription,
} from "@/lib/api/events";
import type {
	EventSink,
	EventSubscription,
	EventSubscriptionFilter,
	EventSinkKind,
	NewEventSubscription,
	UpdateEventSubscription,
} from "@/lib/api/generated/models";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

type CollectionEventSubscriptionsPanelProps = {
	collectionId: number;
	canManage: boolean;
	isPermissionPending: boolean;
};

type SubscriptionFormState = {
	actions: string[];
	actorKinds: string[];
	actorUserIds: string;
	cc: string;
	bcc: string;
	correlationIds: string;
	description: string;
	enabled: boolean;
	entityIds: string;
	entityNames: string;
	entityTypes: string[];
	includeCurrentCollection: boolean;
	name: string;
	collectionIds: string;
	recipients: string;
	relatedCollectionIds: string;
	requestIds: string;
	routingJson: string;
	routingMode: "structured" | "json";
	sinkId: string;
	stream: string;
	url: string;
};

const SUBSCRIPTION_EDITOR_STEPS = [
	{ id: "destination", label: "Destination", hint: "Name and event sink" },
	{ id: "events", label: "Events", hint: "Entity types and actions" },
	{ id: "filters", label: "Filters", hint: "Optional match rules" },
	{ id: "routing", label: "Routing", hint: "Sink-specific delivery" },
	{ id: "review", label: "Review", hint: "Confirm and save" },
] as const;

type SubscriptionEditorStep = (typeof SUBSCRIPTION_EDITOR_STEPS)[number]["id"];

const ENTITY_TYPE_OPTIONS = [
	"collection",
	"class",
	"object",
	"class_relation",
	"object_relation",
	"task",
	"template",
	"remote_target",
	"user",
	"group",
];

const ACTION_OPTIONS = [
	"created",
	"updated",
	"deleted",
	"failed",
	"succeeded",
	"cancelled",
];

const ACTOR_KIND_OPTIONS = ["user", "service_account", "system", "worker"];

const EMPTY_FORM: SubscriptionFormState = {
	actions: [],
	actorKinds: [],
	actorUserIds: "",
	cc: "",
	bcc: "",
	correlationIds: "",
	description: "",
	enabled: true,
	entityIds: "",
	entityNames: "",
	entityTypes: [],
	includeCurrentCollection: true,
	name: "",
	collectionIds: "",
	recipients: "",
	relatedCollectionIds: "",
	requestIds: "",
	routingJson: "{}",
	routingMode: "structured",
	sinkId: "",
	stream: "",
	url: "",
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

function splitTokens(value: string): string[] {
	return value
		.split(/[,\n]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseNumberTokens(value: string, label: string): number[] | undefined {
	const tokens = splitTokens(value);
	if (tokens.length === 0) {
		return undefined;
	}

	const parsed = tokens.map((token) => Number.parseInt(token, 10));
	if (parsed.some((item) => !Number.isFinite(item) || item < 1)) {
		throw new Error(`${label} must contain positive integer IDs.`);
	}

	return parsed;
}

function optionalStringTokens(value: string): string[] | undefined {
	const tokens = splitTokens(value);
	return tokens.length > 0 ? tokens : undefined;
}

function mergeUniqueNumbers(
	...groups: (number[] | undefined)[]
): number[] | undefined {
	const values = groups.flatMap((group) => group ?? []);
	if (values.length === 0) {
		return undefined;
	}

	return Array.from(new Set(values));
}

function parseJsonObject(value: string, label: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error(`${label} must be valid JSON.`);
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${label} must be a JSON object.`);
	}

	return parsed;
}

function toggleListValue(values: string[], value: string): string[] {
	return values.includes(value)
		? values.filter((item) => item !== value)
		: [...values, value];
}

function getSinkLabel(sink: EventSink): string {
	return `${sink.name} (#${sink.id}) · ${sink.kind}${sink.enabled ? "" : " · disabled"}`;
}

function getDefaultRoutingMode(
	sinkKind: EventSinkKind | undefined,
): "structured" | "json" {
	return sinkKind === "webhook" ||
		sinkKind === "email" ||
		sinkKind === "valkey_stream"
		? "structured"
		: "json";
}

function routingToFormFields(
	routing: unknown,
	sinkKind: EventSinkKind | undefined,
): Pick<
	SubscriptionFormState,
	"bcc" | "cc" | "recipients" | "routingJson" | "routingMode" | "stream" | "url"
> {
	const object =
		typeof routing === "object" && routing !== null && !Array.isArray(routing)
			? (routing as Record<string, unknown>)
			: {};

	return {
		bcc: Array.isArray(object.bcc) ? object.bcc.join(", ") : "",
		cc: Array.isArray(object.cc) ? object.cc.join(", ") : "",
		recipients: Array.isArray(object.recipients)
			? object.recipients.join(", ")
			: Array.isArray(object.to)
				? object.to.join(", ")
				: "",
		routingJson: JSON.stringify(object, null, 2),
		routingMode: getDefaultRoutingMode(sinkKind),
		stream: typeof object.stream === "string" ? object.stream : "",
		url: typeof object.url === "string" ? object.url : "",
	};
}

function subscriptionToForm(
	subscription: EventSubscription,
	sinkKind: EventSinkKind | undefined,
	collectionId: number,
): SubscriptionFormState {
	const filter = subscription.filter ?? {};
	const collectionIds = filter.collection_ids ?? [];
	const includeCurrentCollection = collectionIds.includes(collectionId);
	const otherCollectionIds = collectionIds.filter((id) => id !== collectionId);
	return {
		...EMPTY_FORM,
		...routingToFormFields(subscription.routing, sinkKind),
		actions: subscription.actions,
		actorKinds: filter.actor_kinds ?? [],
		actorUserIds: (filter.actor_user_ids ?? []).join(", "),
		correlationIds: (filter.correlation_ids ?? []).join(", "),
		description: subscription.description,
		enabled: subscription.enabled,
		entityIds: (filter.entity_ids ?? []).join(", "),
		entityNames: (filter.entity_names ?? []).join(", "),
		entityTypes: subscription.entity_types,
		includeCurrentCollection,
		name: subscription.name,
		collectionIds: otherCollectionIds.join(", "),
		relatedCollectionIds: (filter.related_collection_ids ?? []).join(", "),
		requestIds: (filter.request_ids ?? []).join(", "),
		sinkId: String(subscription.sink_id),
	};
}

function buildFilter(
	form: SubscriptionFormState,
	collectionId: number,
): EventSubscriptionFilter | undefined {
	const collectionIds = mergeUniqueNumbers(
		form.includeCurrentCollection ? [collectionId] : undefined,
		parseNumberTokens(form.collectionIds, "Collection filters"),
	);
	const filter: EventSubscriptionFilter = {};
	if (collectionIds) {
		filter.collection_ids = collectionIds;
	}

	const relatedCollectionIds = parseNumberTokens(
		form.relatedCollectionIds,
		"Related collection filters",
	);
	if (relatedCollectionIds) {
		filter.related_collection_ids = relatedCollectionIds;
	}

	const entityIds = parseNumberTokens(form.entityIds, "Entity filters");
	if (entityIds) {
		filter.entity_ids = entityIds;
	}

	const actorUserIds = parseNumberTokens(form.actorUserIds, "Actor filters");
	if (actorUserIds) {
		filter.actor_user_ids = actorUserIds;
	}

	const entityNames = optionalStringTokens(form.entityNames);
	if (entityNames) {
		filter.entity_names = entityNames;
	}

	if (form.actorKinds.length > 0) {
		filter.actor_kinds = form.actorKinds;
	}

	const requestIds = optionalStringTokens(form.requestIds);
	if (requestIds) {
		filter.request_ids = requestIds;
	}

	const correlationIds = optionalStringTokens(form.correlationIds);
	if (correlationIds) {
		filter.correlation_ids = correlationIds;
	}

	return Object.keys(filter).length > 0 ? filter : undefined;
}

function buildRouting(
	form: SubscriptionFormState,
	sinkKind: EventSinkKind | undefined,
): unknown {
	if (form.routingMode === "json") {
		return parseJsonObject(form.routingJson, "Routing");
	}

	if (sinkKind === "webhook") {
		const url = form.url.trim();
		if (!url) {
			throw new Error("Webhook URL is required.");
		}
		return { url };
	}

	if (sinkKind === "email") {
		const recipients = optionalStringTokens(form.recipients);
		if (!recipients?.length) {
			throw new Error("At least one email recipient is required.");
		}
		return {
			recipients,
			...(optionalStringTokens(form.cc)
				? { cc: optionalStringTokens(form.cc) }
				: {}),
			...(optionalStringTokens(form.bcc)
				? { bcc: optionalStringTokens(form.bcc) }
				: {}),
		};
	}

	if (sinkKind === "valkey_stream") {
		const stream = form.stream.trim();
		if (!stream) {
			throw new Error("Valkey stream is required.");
		}
		return { stream };
	}

	return parseJsonObject(form.routingJson, "Routing");
}

function buildPayload(
	form: SubscriptionFormState,
	collectionId: number,
	selectedSink: EventSink | undefined,
): NewEventSubscription {
	const sinkId = Number.parseInt(form.sinkId, 10);
	if (!Number.isFinite(sinkId) || sinkId < 1) {
		throw new Error("Sink is required.");
	}

	const name = form.name.trim();
	if (!name) {
		throw new Error("Name is required.");
	}

	if (form.entityTypes.length === 0) {
		throw new Error("Select at least one entity type.");
	}

	if (form.actions.length === 0) {
		throw new Error("Select at least one action.");
	}

	return {
		actions: form.actions,
		description: form.description.trim(),
		enabled: form.enabled,
		entity_types: form.entityTypes,
		filter: buildFilter(form, collectionId),
		name,
		routing: buildRouting(form, selectedSink?.kind),
		sink_id: sinkId,
	};
}

function getStepError(
	step: SubscriptionEditorStep,
	form: SubscriptionFormState,
	collectionId: number,
	selectedSink: EventSink | undefined,
): string | null {
	try {
		if (step === "destination") {
			if (!form.name.trim()) throw new Error("Name is required.");
			if (!selectedSink) throw new Error("Select an event sink.");
			return null;
		}
		if (step === "events") {
			if (form.entityTypes.length === 0) {
				throw new Error("Select at least one entity type.");
			}
			if (form.actions.length === 0) {
				throw new Error("Select at least one action.");
			}
			return null;
		}
		if (step === "filters") {
			buildFilter(form, collectionId);
			return null;
		}
		if (step === "routing") {
			buildRouting(form, selectedSink?.kind);
			return null;
		}

		buildPayload(form, collectionId, selectedSink);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : "Invalid subscription.";
	}
}

function formatRoutingSummary(
	form: SubscriptionFormState,
	sinkKind: EventSinkKind | undefined,
): string {
	if (form.routingMode === "json") return "Advanced JSON routing";
	if (sinkKind === "webhook") return form.url.trim() || "Webhook URL not set";
	if (sinkKind === "email") {
		return form.recipients.trim() || "Recipients not set";
	}
	if (sinkKind === "valkey_stream") {
		return form.stream.trim() || "Stream not set";
	}
	return "Advanced JSON routing";
}

function formatFilterSummary(
	filter: EventSubscriptionFilter | undefined,
): string {
	if (!filter || Object.keys(filter).length === 0) {
		return "No extra filters";
	}

	const parts: string[] = [];
	if (filter.collection_ids?.length) {
		parts.push(`collections ${filter.collection_ids.join(", ")}`);
	}
	if (filter.related_collection_ids?.length) {
		parts.push(`related ${filter.related_collection_ids.join(", ")}`);
	}
	if (filter.entity_ids?.length) {
		parts.push(`entities ${filter.entity_ids.join(", ")}`);
	}
	if (filter.entity_names?.length) {
		parts.push(`names ${filter.entity_names.join(", ")}`);
	}
	if (filter.actor_kinds?.length) {
		parts.push(`actors ${filter.actor_kinds.join(", ")}`);
	}
	if (filter.actor_user_ids?.length) {
		parts.push(`actor IDs ${filter.actor_user_ids.join(", ")}`);
	}
	if (filter.request_ids?.length) {
		parts.push(`requests ${filter.request_ids.length}`);
	}
	if (filter.correlation_ids?.length) {
		parts.push(`correlations ${filter.correlation_ids.length}`);
	}

	return parts.join(" · ");
}

export function CollectionEventSubscriptionsPanel({
	collectionId,
	canManage,
	isPermissionPending,
}: CollectionEventSubscriptionsPanelProps) {
	const queryClient = useQueryClient();
	const [isEditorOpen, setEditorOpen] = useState(false);
	const [editingSubscriptionId, setEditingSubscriptionId] = useState<
		number | null
	>(null);
	const [form, setForm] = useState<SubscriptionFormState>(EMPTY_FORM);
	const [formError, setFormError] = useState<string | null>(null);
	const [activeStep, setActiveStep] =
		useState<SubscriptionEditorStep>("destination");

	const subscriptionsQuery = useQuery({
		queryKey: ["collection-event-subscriptions", collectionId],
		queryFn: () => fetchCollectionEventSubscriptions(collectionId),
		enabled: canManage,
	});
	const sinksQuery = useQuery({
		queryKey: ["event-sinks", "collection-subscriptions"],
		queryFn: fetchEventSinks,
		enabled: canManage,
	});

	const sinks = sinksQuery.data ?? [];
	const selectedSink = sinks.find((sink) => String(sink.id) === form.sinkId);
	const editingSubscription = (subscriptionsQuery.data ?? []).find(
		(subscription) => subscription.id === editingSubscriptionId,
	);

	const createMutation = useMutation({
		mutationFn: (payload: NewEventSubscription) =>
			createCollectionEventSubscription(collectionId, payload),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["collection-event-subscriptions", collectionId],
			});
			setEditorOpen(false);
			setEditingSubscriptionId(null);
			setFormError(null);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to create event subscription.",
			);
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({
			subscriptionId,
			payload,
		}: {
			subscriptionId: number;
			payload: UpdateEventSubscription;
		}) =>
			updateCollectionEventSubscription(collectionId, subscriptionId, payload),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["collection-event-subscriptions", collectionId],
			});
			setEditorOpen(false);
			setEditingSubscriptionId(null);
			setFormError(null);
		},
		onError: (error) => {
			setFormError(
				error instanceof Error
					? error.message
					: "Failed to update event subscription.",
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (subscriptionId: number) =>
			deleteCollectionEventSubscription(collectionId, subscriptionId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["collection-event-subscriptions", collectionId],
			});
		},
	});

	useEffect(() => {
		if (form.sinkId || sinks.length === 0 || editingSubscriptionId !== null) {
			return;
		}

		const firstEnabledSink = sinks.find((sink) => sink.enabled) ?? sinks[0];
		setForm((current) => ({
			...current,
			routingMode: getDefaultRoutingMode(firstEnabledSink.kind),
			sinkId: String(firstEnabledSink.id),
		}));
	}, [editingSubscriptionId, form.sinkId, sinks]);

	const sinkLookup = useMemo(
		() => new Map(sinks.map((sink) => [sink.id, sink])),
		[sinks],
	);

	function patchForm(patch: Partial<SubscriptionFormState>) {
		setForm((current) => ({ ...current, ...patch }));
		setFormError(null);
	}

	function startCreate() {
		const firstSink = sinks.find((sink) => sink.enabled) ?? sinks[0];
		setForm({
			...EMPTY_FORM,
			routingMode: getDefaultRoutingMode(firstSink?.kind),
			sinkId: firstSink ? String(firstSink.id) : "",
		});
		setEditingSubscriptionId(null);
		setFormError(null);
		setActiveStep("destination");
		setEditorOpen(true);
	}

	function startEdit(subscription: EventSubscription) {
		const sink = sinkLookup.get(subscription.sink_id);
		setForm(subscriptionToForm(subscription, sink?.kind, collectionId));
		setEditingSubscriptionId(subscription.id);
		setFormError(null);
		setActiveStep("destination");
		setEditorOpen(true);
	}

	function cancelEditor() {
		setEditorOpen(false);
		setEditingSubscriptionId(null);
		setFormError(null);
		setActiveStep("destination");
	}

	function continueFrom(
		step: SubscriptionEditorStep,
		nextStep: SubscriptionEditorStep,
	) {
		const error = getStepError(step, form, collectionId, selectedSink);
		setFormError(error);
		if (!error) setActiveStep(nextStep);
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setFormError(null);

		let payload: NewEventSubscription;
		try {
			payload = buildPayload(form, collectionId, selectedSink);
		} catch (error) {
			setFormError(error instanceof Error ? error.message : "Invalid form.");
			return;
		}

		if (editingSubscriptionId == null) {
			createMutation.mutate(payload);
			return;
		}

		updateMutation.mutate({
			subscriptionId: editingSubscriptionId,
			payload,
		});
	}

	function onDelete(subscription: EventSubscription) {
		if (!window.confirm(`Delete event subscription "${subscription.name}"?`)) {
			return;
		}

		deleteMutation.mutate(subscription.id);
	}

	const actionPending =
		createMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending;
	useEscapeToCancel({
		enabled: isEditorOpen && !actionPending,
		onCancel: cancelEditor,
	});
	const subscriptions = subscriptionsQuery.data ?? [];
	const destinationReady =
		getStepError("destination", form, collectionId, selectedSink) === null;
	const eventsReady =
		destinationReady &&
		getStepError("events", form, collectionId, selectedSink) === null;
	const filtersReady =
		eventsReady &&
		getStepError("filters", form, collectionId, selectedSink) === null;
	const routingReady =
		filtersReady &&
		getStepError("routing", form, collectionId, selectedSink) === null;
	const editorSteps = SUBSCRIPTION_EDITOR_STEPS.map((step) => ({
		...step,
		enabled:
			step.id === "destination" ||
			(step.id === "events" && destinationReady) ||
			(step.id === "filters" && eventsReady) ||
			(step.id === "routing" && filtersReady) ||
			(step.id === "review" && routingReady),
	}));
	let reviewFilterSummary = "No extra filters";
	try {
		reviewFilterSummary = formatFilterSummary(buildFilter(form, collectionId));
	} catch {
		reviewFilterSummary = "Review invalid filter values";
	}
	const subscriptionsExportView = {
		id: `collection-${collectionId}-event-subscriptions`,
		fileName: `collection-${collectionId}-event-subscriptions`,
		sheetName: "Event subscriptions",
		columns: [
			{
				key: "name",
				label: "Name",
				getValue: (subscription: EventSubscription) =>
					`${subscription.name} (#${subscription.id})`,
			},
			{
				key: "sink",
				label: "Sink",
				getValue: (subscription: EventSubscription) => {
					const sink = sinkLookup.get(subscription.sink_id);
					return sink ? getSinkLabel(sink) : `#${subscription.sink_id}`;
				},
			},
			{
				key: "match",
				label: "Match",
				getValue: (subscription: EventSubscription) =>
					`${subscription.entity_types.join(", ")} · ${subscription.actions.join(", ")}`,
			},
			{
				key: "filters",
				label: "Filters",
				getValue: (subscription: EventSubscription) =>
					formatFilterSummary(subscription.filter),
			},
			{
				key: "enabled",
				label: "Enabled",
				getValue: (subscription: EventSubscription) =>
					subscription.enabled ? "yes" : "no",
			},
			{
				key: "updated",
				label: "Updated",
				getValue: (subscription: EventSubscription) =>
					formatTimestamp(subscription.updated_at),
			},
		],
		rows: subscriptions,
	};

	return (
		<article className="card stack panel-card">
			<div className="panel-header">
				<div className="stack action-card-header">
					<h3>Event subscriptions</h3>
					<p className="muted">
						Collection-scoped rules that fan matching audit events out to a
						configured sink.
					</p>
				</div>
				<div className="action-row">
					<TableExportMenu
						view={subscriptionsExportView}
						disabled={subscriptionsQuery.isFetching}
						compact
					/>
					{canManage ? (
						<button
							type="button"
							className="secondary"
							onClick={startCreate}
							disabled={isEditorOpen || sinksQuery.isLoading}
						>
							New subscription
						</button>
					) : null}
				</div>
			</div>

			{isPermissionPending ? (
				<div className="muted">
					Checking whether you can manage event subscriptions...
				</div>
			) : null}
			{!isPermissionPending && !canManage ? (
				<div className="empty-state">
					Event subscription management is not available with your current
					collection permissions.
				</div>
			) : null}

			{subscriptionsQuery.isLoading ? (
				<div className="muted">Loading event subscriptions...</div>
			) : null}
			{subscriptionsQuery.isError ? (
				<div className="error-banner">
					Failed to load event subscriptions.{" "}
					{subscriptionsQuery.error instanceof Error
						? subscriptionsQuery.error.message
						: "Unknown error"}
				</div>
			) : null}
			{sinksQuery.isError ? (
				<div className="error-banner">
					Failed to load event sinks.{" "}
					{sinksQuery.error instanceof Error
						? sinksQuery.error.message
						: "Unknown error"}
				</div>
			) : null}
			{deleteMutation.isError ? (
				<div className="error-banner">
					Failed to delete event subscription.{" "}
					{deleteMutation.error instanceof Error
						? deleteMutation.error.message
						: "Unknown error"}
				</div>
			) : null}

			{isEditorOpen ? (
				<form className="stack event-subscription-editor" onSubmit={onSubmit}>
					<div className="panel-header">
						<div className="stack action-card-header">
							<h4>
								{editingSubscriptionId == null
									? "Create event subscription"
									: "Edit event subscription"}
							</h4>
							<p className="muted">
								Choose the destination, matching events, optional filters, and
								routing.
							</p>
						</div>
						<button
							type="button"
							className="ghost"
							onClick={cancelEditor}
							disabled={actionPending}
						>
							Cancel
						</button>
					</div>

					<GuidedFlowTabs
						activeStep={activeStep}
						ariaLabel="Event subscription steps"
						onChange={(step) => {
							setFormError(null);
							setActiveStep(step);
						}}
						steps={editorSteps}
					/>

					{activeStep === "destination" ? (
						<GuidedFlowPanel stepId="destination">
							<div className="form-grid">
								<label className="control-field">
									<span>Name</span>
									<input
										required
										value={form.name}
										onChange={(event) =>
											patchForm({ name: event.target.value })
										}
									/>
								</label>
								<label className="control-field">
									<span>Event sink</span>
									<select
										required
										value={form.sinkId}
										onChange={(event) => {
											const sink = sinks.find(
												(item) => String(item.id) === event.target.value,
											);
											patchForm({
												routingMode: getDefaultRoutingMode(sink?.kind),
												sinkId: event.target.value,
											});
										}}
									>
										<option value="">Select sink</option>
										{sinks.map((sink) => (
											<option key={sink.id} value={sink.id}>
												{getSinkLabel(sink)}
											</option>
										))}
									</select>
								</label>
								<label className="control-field control-field--wide">
									<span>Description</span>
									<input
										value={form.description}
										onChange={(event) =>
											patchForm({ description: event.target.value })
										}
									/>
								</label>
								<label className="checkbox-row">
									<input
										type="checkbox"
										checked={form.enabled}
										onChange={(event) =>
											patchForm({ enabled: event.target.checked })
										}
									/>
									<span>Enable immediately</span>
								</label>
							</div>
							<GuidedFlowContinue
								disabled={!destinationReady}
								nextLabel="Events"
								onContinue={() => continueFrom("destination", "events")}
								summary={
									selectedSink ? getSinkLabel(selectedSink) : "Select a sink"
								}
								title={
									destinationReady
										? "Destination ready"
										: "Name this subscription and choose a sink"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "events" ? (
						<GuidedFlowPanel stepId="events">
							<section className="permission-section">
								<h4 className="permission-section-title">Entity types</h4>
								<p className="muted">
									Choose what kinds of resources can produce a matching event.
								</p>
								<div className="permission-chip-list permission-chip-list--editor">
									{ENTITY_TYPE_OPTIONS.map((entityType) => {
										const enabled = form.entityTypes.includes(entityType);
										return (
											<button
												key={entityType}
												type="button"
												aria-pressed={enabled}
												className={`permission-chip permission-chip-button permission-chip--editor ${enabled ? "permission-chip--active" : "permission-chip--inactive"}`}
												onClick={() =>
													patchForm({
														entityTypes: toggleListValue(
															form.entityTypes,
															entityType,
														),
													})
												}
											>
												{entityType}
											</button>
										);
									})}
								</div>
							</section>
							<section className="permission-section">
								<h4 className="permission-section-title">Actions</h4>
								<div className="permission-chip-list permission-chip-list--editor">
									{ACTION_OPTIONS.map((action) => {
										const enabled = form.actions.includes(action);
										return (
											<button
												key={action}
												type="button"
												aria-pressed={enabled}
												className={`permission-chip permission-chip-button permission-chip--editor ${enabled ? "permission-chip--active" : "permission-chip--inactive"}`}
												onClick={() =>
													patchForm({
														actions: toggleListValue(form.actions, action),
													})
												}
											>
												{action}
											</button>
										);
									})}
								</div>
							</section>
							<GuidedFlowContinue
								disabled={!eventsReady}
								nextLabel="Filters"
								onBack={() => setActiveStep("destination")}
								onContinue={() => continueFrom("events", "filters")}
								summary={`${form.entityTypes.length} entity type${form.entityTypes.length === 1 ? "" : "s"} · ${form.actions.length} action${form.actions.length === 1 ? "" : "s"}`}
								title={
									eventsReady
										? "Event match ready"
										: "Choose at least one entity type and action"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "filters" ? (
						<GuidedFlowPanel stepId="filters">
							<p className="muted">
								Leave optional filters blank to match every selected event in
								scope.
							</p>
							<div className="form-grid">
								<label className="checkbox-row">
									<input
										type="checkbox"
										checked={form.includeCurrentCollection}
										onChange={(event) =>
											patchForm({
												includeCurrentCollection: event.target.checked,
											})
										}
									/>
									<span>Current collection</span>
								</label>
								<label className="control-field">
									<span>Other collection IDs</span>
									<input
										value={form.collectionIds}
										onChange={(event) =>
											patchForm({ collectionIds: event.target.value })
										}
										placeholder="12, 34"
									/>
								</label>
								<label className="control-field">
									<span>Related collection IDs</span>
									<input
										value={form.relatedCollectionIds}
										onChange={(event) =>
											patchForm({ relatedCollectionIds: event.target.value })
										}
										placeholder="56, 78"
									/>
								</label>
								<label className="control-field">
									<span>Entity IDs</span>
									<input
										value={form.entityIds}
										onChange={(event) =>
											patchForm({ entityIds: event.target.value })
										}
										placeholder="123, 456"
									/>
								</label>
								<label className="control-field">
									<span>Entity names</span>
									<input
										value={form.entityNames}
										onChange={(event) =>
											patchForm({ entityNames: event.target.value })
										}
										placeholder="router-1, switch-2"
									/>
								</label>
								<label className="control-field">
									<span>Actor user IDs</span>
									<input
										value={form.actorUserIds}
										onChange={(event) =>
											patchForm({ actorUserIds: event.target.value })
										}
										placeholder="5, 9"
									/>
								</label>
								<label className="control-field">
									<span>Request IDs</span>
									<input
										value={form.requestIds}
										onChange={(event) =>
											patchForm({ requestIds: event.target.value })
										}
									/>
								</label>
								<label className="control-field">
									<span>Correlation IDs</span>
									<input
										value={form.correlationIds}
										onChange={(event) =>
											patchForm({ correlationIds: event.target.value })
										}
									/>
								</label>
							</div>
							<section className="permission-section">
								<h4 className="permission-section-title">Actor kinds</h4>
								<div className="permission-chip-list permission-chip-list--editor">
									{ACTOR_KIND_OPTIONS.map((actorKind) => {
										const enabled = form.actorKinds.includes(actorKind);
										return (
											<button
												key={actorKind}
												type="button"
												aria-pressed={enabled}
												className={`permission-chip permission-chip-button permission-chip--editor ${enabled ? "permission-chip--active" : "permission-chip--inactive"}`}
												onClick={() =>
													patchForm({
														actorKinds: toggleListValue(
															form.actorKinds,
															actorKind,
														),
													})
												}
											>
												{actorKind}
											</button>
										);
									})}
								</div>
							</section>
							<GuidedFlowContinue
								disabled={!filtersReady}
								nextLabel="Routing"
								onBack={() => setActiveStep("events")}
								onContinue={() => continueFrom("filters", "routing")}
								summary={reviewFilterSummary}
								title={
									filtersReady ? "Filters ready" : "Review the filter values"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "routing" ? (
						<GuidedFlowPanel stepId="routing">
							<div className="segmented-control">
								<button
									type="button"
									className={
										form.routingMode === "structured" ? "is-active" : ""
									}
									onClick={() => patchForm({ routingMode: "structured" })}
									disabled={!selectedSink || selectedSink.kind === "amqp"}
								>
									Structured
								</button>
								<button
									type="button"
									className={form.routingMode === "json" ? "is-active" : ""}
									onClick={() => patchForm({ routingMode: "json" })}
								>
									Advanced JSON
								</button>
							</div>
							{form.routingMode === "structured" ? (
								selectedSink?.kind === "webhook" ? (
									<label className="control-field">
										<span>Webhook URL</span>
										<input
											type="url"
											value={form.url}
											onChange={(event) =>
												patchForm({ url: event.target.value })
											}
										/>
									</label>
								) : selectedSink?.kind === "email" ? (
									<div className="form-grid">
										<label className="control-field">
											<span>Recipients</span>
											<input
												value={form.recipients}
												onChange={(event) =>
													patchForm({ recipients: event.target.value })
												}
												placeholder="Ops <ops@example.com>"
											/>
										</label>
										<label className="control-field">
											<span>CC</span>
											<input
												value={form.cc}
												onChange={(event) =>
													patchForm({ cc: event.target.value })
												}
											/>
										</label>
										<label className="control-field">
											<span>BCC</span>
											<input
												value={form.bcc}
												onChange={(event) =>
													patchForm({ bcc: event.target.value })
												}
											/>
										</label>
									</div>
								) : selectedSink?.kind === "valkey_stream" ? (
									<label className="control-field">
										<span>Stream</span>
										<input
											value={form.stream}
											onChange={(event) =>
												patchForm({ stream: event.target.value })
											}
											placeholder="hubuum:events"
										/>
									</label>
								) : (
									<div className="muted">
										Use advanced JSON routing for this sink type.
									</div>
								)
							) : (
								<label className="control-field control-field--wide">
									<span>Routing JSON</span>
									<textarea
										rows={8}
										value={form.routingJson}
										onChange={(event) =>
											patchForm({ routingJson: event.target.value })
										}
									/>
								</label>
							)}
							<GuidedFlowContinue
								disabled={!routingReady}
								nextLabel="Review"
								onBack={() => setActiveStep("filters")}
								onContinue={() => continueFrom("routing", "review")}
								summary={formatRoutingSummary(form, selectedSink?.kind)}
								title={
									routingReady
										? "Routing ready"
										: "Complete the routing destination"
								}
							/>
						</GuidedFlowPanel>
					) : null}

					{activeStep === "review" ? (
						<GuidedFlowPanel stepId="review">
							<dl className="guided-flow-review-list">
								<div>
									<dt>Subscription</dt>
									<dd>
										{form.name} · {form.enabled ? "enabled" : "disabled"}
									</dd>
								</div>
								<div>
									<dt>Destination</dt>
									<dd>
										{selectedSink
											? getSinkLabel(selectedSink)
											: "No sink selected"}
									</dd>
								</div>
								<div>
									<dt>Matches</dt>
									<dd>
										{form.entityTypes.join(", ")} · {form.actions.join(", ")}
									</dd>
								</div>
								<div>
									<dt>Filters</dt>
									<dd>{reviewFilterSummary}</dd>
								</div>
								<div>
									<dt>Routing</dt>
									<dd>{formatRoutingSummary(form, selectedSink?.kind)}</dd>
								</div>
							</dl>
							<div className="form-actions">
								<button
									type="button"
									className="ghost"
									onClick={() => setActiveStep("routing")}
									disabled={actionPending}
								>
									Back
								</button>
								<button type="submit" disabled={actionPending || !routingReady}>
									{actionPending
										? "Saving..."
										: editingSubscriptionId == null
											? "Create subscription"
											: "Save subscription"}
								</button>
							</div>
						</GuidedFlowPanel>
					) : null}

					{formError ? <div className="error-banner">{formError}</div> : null}
				</form>
			) : null}

			{!subscriptionsQuery.isLoading &&
			!subscriptionsQuery.isError &&
			(subscriptionsQuery.data?.length ?? 0) === 0 ? (
				<div className="empty-state">No event subscriptions configured.</div>
			) : null}

			{subscriptions.length ? (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Sink</th>
								<th>Match</th>
								<th>Filters</th>
								<th>Enabled</th>
								<th>Updated</th>
								{canManage ? <th>Actions</th> : null}
							</tr>
						</thead>
						<tbody>
							{subscriptions.map((subscription) => {
								const sink = sinkLookup.get(subscription.sink_id);
								return (
									<tr key={subscription.id}>
										<td>
											<strong>{subscription.name}</strong>
											<div className="muted">#{subscription.id}</div>
										</td>
										<td>
											{sink ? getSinkLabel(sink) : `#${subscription.sink_id}`}
										</td>
										<td>
											{subscription.entity_types.join(", ")} ·{" "}
											{subscription.actions.join(", ")}
										</td>
										<td>{formatFilterSummary(subscription.filter)}</td>
										<td>{subscription.enabled ? "yes" : "no"}</td>
										<td>{formatTimestamp(subscription.updated_at)}</td>
										{canManage ? (
											<td>
												<div className="table-tools">
													<button
														type="button"
														className="ghost"
														onClick={() => startEdit(subscription)}
														disabled={actionPending}
													>
														Edit
													</button>
													<button
														type="button"
														className="danger"
														onClick={() => onDelete(subscription)}
														disabled={actionPending}
													>
														Delete
													</button>
												</div>
											</td>
										) : null}
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : null}

			{editingSubscription ? (
				<details className="stack">
					<summary>Current routing and filter JSON</summary>
					<JsonViewer
						value={{
							filter: editingSubscription.filter ?? null,
							routing: editingSubscription.routing,
						}}
					/>
				</details>
			) : null}
		</article>
	);
}
