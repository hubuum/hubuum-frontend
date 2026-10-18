import { afterEach, expect, it, vi } from "vitest";
import {
	createSystemEventSubscription,
	deleteSystemEventSubscription,
	fetchSystemEventSubscriptions,
	previewEventNotification,
	testEventNotification,
	updateSystemEventSubscription,
} from "@/lib/api/system-events";
afterEach(() => vi.unstubAllGlobals());
it("uses the BFF for system subscription reads and writes", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response("[]"))
		.mockResolvedValueOnce(new Response('{"id":9}', { status: 201 }))
		.mockResolvedValueOnce(new Response('{"id":9}'))
		.mockResolvedValueOnce(new Response(null, { status: 204 }));
	vi.stubGlobal("fetch", fetch);
	const payload = {
		name: "Logins",
		sink_id: 7,
		entity_types: ["authentication"],
		actions: ["succeeded"],
		filter: { subject_is_admin: false },
	};
	await fetchSystemEventSubscriptions();
	await createSystemEventSubscription(payload);
	await updateSystemEventSubscription(9, { filter: {} });
	await deleteSystemEventSubscription(9);
	expect(
		fetch.mock.calls.map(([url, options]) => [url, options.method]),
	).toEqual([
		["/_hubuum-bff/hubuum/api/v1/system-event-subscriptions", "GET"],
		["/_hubuum-bff/hubuum/api/v1/system-event-subscriptions", "POST"],
		["/_hubuum-bff/hubuum/api/v1/system-event-subscriptions/9", "PATCH"],
		["/_hubuum-bff/hubuum/api/v1/system-event-subscriptions/9", "DELETE"],
	]);
	expect(
		fetch.mock.calls.every(([, options]) => options.credentials === "include"),
	).toBe(true);
	expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ filter: {} });
});
it("separates preview from test delivery and does not retry failures", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response('{"payload":{}}'))
		.mockResolvedValueOnce(new Response('{"id":8}', { status: 202 }))
		.mockResolvedValueOnce(
			new Response('{"message":"Forbidden"}', { status: 403 }),
		);
	vi.stubGlobal("fetch", fetch);
	const request = { event_id: "event-uuid", subscription_id: 9 };
	await previewEventNotification(7, request);
	await testEventNotification(7, request);
	await expect(testEventNotification(7, request)).rejects.toThrow("Forbidden");
	expect(fetch.mock.calls.map(([url]) => url)).toEqual([
		"/_hubuum-bff/hubuum/api/v1/event-sinks/7/preview",
		"/_hubuum-bff/hubuum/api/v1/event-sinks/7/test",
		"/_hubuum-bff/hubuum/api/v1/event-sinks/7/test",
	]);
});
