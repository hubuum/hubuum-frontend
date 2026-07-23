import { getApiErrorMessage } from "@/lib/api/errors";
import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import {
	deleteApiV1EventSinksBySinkId,
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
	getApiV1CollectionsByCollectionIdEventSubscriptions,
	getApiV1CollectionsByCollectionIdEvents,
	getApiV1CollectionsByCollectionIdHistory,
	getApiV1CollectionsByCollectionIdHistoryAsOf,
	patchApiV1EventSinksBySinkId,
	patchApiV1CollectionsByCollectionIdEventSubscriptionsBySubscriptionId,
	postApiV1EventSinks,
	postApiV1CollectionsByCollectionIdEventSubscriptions,
	deleteApiV1CollectionsByCollectionIdEventSubscriptionsBySubscriptionId,
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
	HistoryResponseCollectionHistory,
	NewEventSink,
	NewEventSubscription,
	UpdateEventSink,
	UpdateEventSubscription,
} from "@/lib/api/generated/models";

export type EventRecord = EventResponse;
export type HistoryRecord =
	| HistoryResponseHubuumClassHistory
	| HistoryResponseHubuumObjectHistory
	| HistoryResponseCollectionHistory;

export type PageResult<T> = {
	items: T[];
	nextCursor: string | null;
	totalCount: number | null;
};

export type ResourceEventScope =
	| { type: "collection"; collectionId: number }
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
	options: Omit<
		EventListOptions,
		"entity_type" | "entity_id" | "collection_id"
	> = {},
): Promise<PageResult<EventRecord>> {
	const params = {
		limit: options.limit ?? 25,
		sort: options.sort ?? "-occurred_at,-id",
		...options,
	};

	if (scope.type === "collection") {
		const response = await getApiV1CollectionsByCollectionIdEvents(
			scope.collectionId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load collection events.",
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
		sort: options.sort ?? "-history_id",
		cursor: options.cursor,
	};

	if (scope.type === "collection") {
		const response = await getApiV1CollectionsByCollectionIdHistory(
			scope.collectionId,
			params,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load collection history.",
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
	if (scope.type === "collection") {
		const response = await getApiV1CollectionsByCollectionIdHistoryAsOf(
			scope.collectionId,
			{ at },
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load collection snapshot.",
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
	const response = await getApiV1EventDeliveries(params, {
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load event deliveries.",
	);
	return pageFromResponse(response.data as EventDelivery[], response.headers);
}

export async function fetchEventSinks(): Promise<EventSink[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1EventSinks(
			{ cursor, include_total: false, limit: 250 },
			{ credentials: "include" },
		);

		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load event sinks.",
		);
		return {
			items: response.data as EventSink[],
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});
}

export async function createEventSink(
	payload: NewEventSink,
): Promise<EventSink> {
	const response = await postApiV1EventSinks(payload, {
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		201,
		"Failed to create event sink.",
	);
	return response.data as EventSink;
}

export async function updateEventSink(
	sinkId: number,
	payload: UpdateEventSink,
): Promise<EventSink> {
	const response = await patchApiV1EventSinksBySinkId(sinkId, payload, {
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to update event sink.",
	);
	return response.data as EventSink;
}

export async function deleteEventSink(sinkId: number): Promise<void> {
	const response = await deleteApiV1EventSinksBySinkId(sinkId, {
		credentials: "include",
	});

	assertStatus(
		response.status,
		response.data,
		204,
		"Failed to delete event sink.",
	);
}

export async function fetchCollectionEventSubscriptions(
	collectionId: number,
): Promise<EventSubscription[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1CollectionsByCollectionIdEventSubscriptions(
			collectionId,
			{ cursor, include_total: false, limit: 250 },
			{ credentials: "include" },
		);

		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to load event subscriptions.",
		);
		return {
			items: response.data as EventSubscription[],
			nextCursor: response.headers.get("x-next-cursor"),
		};
	});
}

export async function createCollectionEventSubscription(
	collectionId: number,
	payload: NewEventSubscription,
): Promise<EventSubscription> {
	const response = await postApiV1CollectionsByCollectionIdEventSubscriptions(
		collectionId,
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

export async function updateCollectionEventSubscription(
	collectionId: number,
	subscriptionId: number,
	payload: UpdateEventSubscription,
): Promise<EventSubscription> {
	const response =
		await patchApiV1CollectionsByCollectionIdEventSubscriptionsBySubscriptionId(
			collectionId,
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

export async function deleteCollectionEventSubscription(
	collectionId: number,
	subscriptionId: number,
): Promise<void> {
	const response =
		await deleteApiV1CollectionsByCollectionIdEventSubscriptionsBySubscriptionId(
			collectionId,
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

export async function retryEventDelivery(
	deliveryId: number,
): Promise<EventDelivery> {
	const response = await postApiV1EventDeliveriesByDeliveryIdRetry(deliveryId, {
		credentials: "include",
	});

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
