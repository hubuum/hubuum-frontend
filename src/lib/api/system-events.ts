import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1SystemEventSubscriptionsBySubscriptionId,
	getApiV1SystemEventSubscriptions,
	patchApiV1SystemEventSubscriptionsBySubscriptionId,
	postApiV1SystemEventSubscriptions,
	postApiV1EventSinksBySinkIdPreview,
	postApiV1EventSinksBySinkIdTest,
} from "@/lib/api/generated/client";
import type {
	NewEventSubscription,
	UpdateEventSubscription,
	EventNotificationRequest,
} from "@/lib/api/generated/models";

export async function fetchSystemEventSubscriptions() {
	const response = await getApiV1SystemEventSubscriptions({
		credentials: "include",
	});
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"System subscriptions require administrator access.",
			),
		);
	return response.data;
}
export async function createSystemEventSubscription(
	payload: NewEventSubscription,
) {
	const response = await postApiV1SystemEventSubscriptions(payload, {
		credentials: "include",
	});
	if (response.status !== 201)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not create system subscription.",
			),
		);
	return response.data;
}
export async function updateSystemEventSubscription(
	id: number,
	payload: UpdateEventSubscription,
) {
	const response = await patchApiV1SystemEventSubscriptionsBySubscriptionId(
		id,
		payload,
		{ credentials: "include" },
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not update system subscription. Reload and review before retrying.",
			),
		);
	return response.data;
}
export async function deleteSystemEventSubscription(id: number) {
	const response = await deleteApiV1SystemEventSubscriptionsBySubscriptionId(
		id,
		{ credentials: "include" },
	);
	if (response.status !== 204)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not delete system subscription.",
			),
		);
}
export async function previewEventNotification(
	sinkId: number,
	request: EventNotificationRequest,
) {
	const response = await postApiV1EventSinksBySinkIdPreview(sinkId, request, {
		credentials: "include",
	});
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Could not preview notification."),
		);
	return response.data;
}
export async function testEventNotification(
	sinkId: number,
	request: EventNotificationRequest,
) {
	const response = await postApiV1EventSinksBySinkIdTest(sinkId, request, {
		credentials: "include",
	});
	if (response.status !== 202)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Could not queue test notification. Check deliveries before retrying.",
			),
		);
	return response.data;
}
