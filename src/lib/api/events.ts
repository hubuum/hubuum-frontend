import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1ClassesByClassIdByObjectIdEvents,
	getApiV1ClassesByClassIdByObjectIdHistory,
	getApiV1ClassesByClassIdByObjectIdHistoryAsOf,
	getApiV1ClassesByClassIdEvents,
	getApiV1ClassesByClassIdHistory,
	getApiV1ClassesByClassIdHistoryAsOf,
	getApiV1EventDeliveries,
	getApiV1EventDeliveriesHealth,
	getApiV1EventSinks,
	getApiV1Events,
	getApiV1NamespacesByNamespaceIdEventSubscriptions,
	getApiV1NamespacesByNamespaceIdEvents,
	getApiV1NamespacesByNamespaceIdHistory,
	getApiV1NamespacesByNamespaceIdHistoryAsOf,
	patchApiV1NamespacesByNamespaceIdEventSubscriptionsBySubscriptionId,
	postApiV1NamespacesByNamespaceIdEventSubscriptions,
	deleteApiV1NamespacesByNamespaceIdEventSubscriptionsBySubscriptionId,
	postApiV1EventDeliveriesByDeliveryIdDead,
	postApiV1EventDeliveriesByDeliveryIdRetry,
} from "@/lib/api/generated/client";
import type {
	EventDelivery,
	EventDeliveryHealthResponse,
	EventResponse,
	EventSink,
	EventSubscription,
	GetApiV1EventsParams,
	HistoryResponseHubuumClassHistory,
	HistoryResponseHubuumObjectHistory,
	HistoryResponseNamespaceHistory,
	NewEventSubscription,
	UpdateEventSubscription,
} from "@/lib/api/generated/models";

export type EventRecord = EventResponse;
export type HistoryRecord =
	| HistoryResponseHubuumClassHistory
	| HistoryResponseHubuumObjectHistory
	| HistoryResponseNamespaceHistory;

export type PageResult<T> = {
	items: T[];
	nextCursor: string | null;
	totalCount: number | null;
};

export type ResourceEventScope =
	| { type: "namespace"; namespaceId: number }
	| { type: "class"; classId: number }
	| { type: "object"; classId: number; objectId: number };

export type EventListOptions = GetApiV1EventsParams;

export type HistoryListOptions = {
	cursor?: string;
	limit?: number;
	sort?: string;
};

function parseCountHeader(value: string | null): number | null {
	if (!value) {
		return null;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function pageFromResponse<T>(data: T[], headers: Headers): PageResult<T> {
	return {
		items: data,
		nextCursor: headers.get("x-next-cursor"),
		totalCount: parseCountHeader(headers.get("x-total-count")),
	};
}

function assertStatus(
	status: number,
	payload: unknown,
	expected: number,
	fallback: string,
) {
	if (status !== expected) {
		throw new Error(getApiErrorMessage(payload, fallback));
	}
}

export async function fetchEventsPage(
	options: EventListOptions = {},
): Promise<PageResult<EventRecord>> {
	const response = await getApiV1Events(
		{
			limit: options.limit ?? 50,
			sort: options.sort ?? "-occurred_at,-id",
			...options,
		},
		{ credentials: "include" },
	);

	assertStatus(response.status, response.data, 200, "Failed to load events.");
	return pageFromResponse(response.data as EventRecord[], response.headers);
}

export async function fetchResourceEventsPage(
	scope: ResourceEventScope,
	options: Omit<EventListOptions, "entity_type" | "entity_id" | "namespace_id"> = {},
): Promise<PageResult<EventRecord>> {
	const params = {
		limit: options.limit ?? 25,
		sort: options.sort ?? "-occurred_at,-id",
		...options,
	};

	if (scope.type === "namespace") {
		const response = await getApiV1NamespacesByNamespaceIdEvents(
			scope.namespaceId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load namespace events.",
		);
		return pageFromResponse(response.data as EventRecord[], response.headers);
	}

	if (scope.type === "class") {
		const response = await getApiV1ClassesByClassIdEvents(
			scope.classId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load class events.",
		);
		return pageFromResponse(response.data as EventRecord[], response.headers);
	}

	const response = await getApiV1ClassesByClassIdByObjectIdEvents(
		scope.classId,
		scope.objectId,
		params,
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load object events.",
	);
	return pageFromResponse(response.data as EventRecord[], response.headers);
}

export async function fetchResourceHistoryPage(
	scope: ResourceEventScope,
	options: HistoryListOptions = {},
): Promise<PageResult<HistoryRecord>> {
	const params = {
		limit: options.limit ?? 25,
		sort: options.sort ?? "-valid_from,-history_id",
		cursor: options.cursor,
	};

	if (scope.type === "namespace") {
		const response = await getApiV1NamespacesByNamespaceIdHistory(
			scope.namespaceId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load namespace history.",
		);
		return pageFromResponse(response.data as HistoryRecord[], response.headers);
	}

	if (scope.type === "class") {
		const response = await getApiV1ClassesByClassIdHistory(
			scope.classId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load class history.",
		);
		return pageFromResponse(response.data as HistoryRecord[], response.headers);
	}

	const response = await getApiV1ClassesByClassIdByObjectIdHistory(
		scope.classId,
		scope.objectId,
		params,
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load object history.",
	);
	return pageFromResponse(response.data as HistoryRecord[], response.headers);
}

export async function fetchResourceHistoryAsOf(
	scope: ResourceEventScope,
	at: string,
): Promise<HistoryRecord> {
	if (scope.type === "namespace") {
		const response = await getApiV1NamespacesByNamespaceIdHistoryAsOf(
			scope.namespaceId,
			{ at },
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load namespace snapshot.",
		);
		return response.data as HistoryRecord;
	}

	if (scope.type === "class") {
		const response = await getApiV1ClassesByClassIdHistoryAsOf(
			scope.classId,
			{ at },
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load class snapshot.",
		);
		return response.data as HistoryRecord;
	}

	const response = await getApiV1ClassesByClassIdByObjectIdHistoryAsOf(
		scope.classId,
		scope.objectId,
		{ at },
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load object snapshot.",
	);
	return response.data as HistoryRecord;
}

export async function fetchEventDeliveryHealth(): Promise<EventDeliveryHealthResponse> {
	const response = await getApiV1EventDeliveriesHealth({
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load event delivery health.",
	);
	return response.data as EventDeliveryHealthResponse;
}

export async function fetchEventDeliveriesPage(
	cursor = "",
): Promise<PageResult<EventDelivery>> {
	const params = {
		limit: 50,
		sort: "-updated_at,-id",
		...(cursor ? { cursor } : {}),
	} as Parameters<typeof getApiV1EventDeliveries>[0];
	const response = await getApiV1EventDeliveries(
		params,
		{ credentials: "include" },
	);

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load event deliveries.",
	);
	return pageFromResponse(response.data as EventDelivery[], response.headers);
}

export async function fetchEventSinks(): Promise<EventSink[]> {
	const response = await getApiV1EventSinks({ credentials: "include" });

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load event sinks.",
	);
	return response.data as EventSink[];
}

export async function fetchNamespaceEventSubscriptions(
	namespaceId: number,
): Promise<EventSubscription[]> {
	const response = await getApiV1NamespacesByNamespaceIdEventSubscriptions(
		namespaceId,
		{ credentials: "include" },
	);

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load event subscriptions.",
	);
	return response.data as EventSubscription[];
}

export async function createNamespaceEventSubscription(
	namespaceId: number,
	payload: NewEventSubscription,
): Promise<EventSubscription> {
	const response = await postApiV1NamespacesByNamespaceIdEventSubscriptions(
		namespaceId,
		payload,
		{ credentials: "include" },
	);

	assertStatus(
		response.status,
		response.data,
		201,
		"Failed to create event subscription.",
	);
	return response.data as EventSubscription;
}

export async function updateNamespaceEventSubscription(
	namespaceId: number,
	subscriptionId: number,
	payload: UpdateEventSubscription,
): Promise<EventSubscription> {
	const response =
		await patchApiV1NamespacesByNamespaceIdEventSubscriptionsBySubscriptionId(
			namespaceId,
			subscriptionId,
			payload,
			{ credentials: "include" },
		);

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to update event subscription.",
	);
	return response.data as EventSubscription;
}

export async function deleteNamespaceEventSubscription(
	namespaceId: number,
	subscriptionId: number,
): Promise<void> {
	const response =
		await deleteApiV1NamespacesByNamespaceIdEventSubscriptionsBySubscriptionId(
			namespaceId,
			subscriptionId,
			{ credentials: "include" },
		);

	assertStatus(
		response.status,
		response.data,
		204,
		"Failed to delete event subscription.",
	);
}

export async function retryEventDelivery(deliveryId: number): Promise<EventDelivery> {
	const response = await postApiV1EventDeliveriesByDeliveryIdRetry(
		deliveryId,
		{ credentials: "include" },
	);

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to retry event delivery.",
	);
	return (response.data as { delivery: EventDelivery }).delivery;
}

export async function markEventDeliveryDead(
	deliveryId: number,
): Promise<EventDelivery> {
	const response = await postApiV1EventDeliveriesByDeliveryIdDead(deliveryId, {
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to mark event delivery dead.",
	);
	return (response.data as { delivery: EventDelivery }).delivery;
}
