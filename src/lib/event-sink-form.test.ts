import { describe, expect, it } from "vitest";
import type { EventSink } from "@/lib/api/generated/models";
import {
	buildEventSinkPayload,
	defaultEventSinkFormState,
	eventSinkToFormState,
	parseEventSinkConfig,
	customizeWebhookPreset,
} from "@/lib/event-sink-form";

describe("parseEventSinkConfig", () => {
	it("uses an empty object for blank configuration", () => {
		expect(parseEventSinkConfig("  ")).toEqual({});
	});

	it("accepts any valid JSON configuration", () => {
		expect(parseEventSinkConfig('["primary", {"retries":3}]')).toEqual([
			"primary",
			{ retries: 3 },
		]);
	});

	it("rejects invalid JSON", () => {
		expect(() => parseEventSinkConfig("{")).toThrow(
			"Configuration must be valid JSON.",
		);
	});
});

describe("buildEventSinkPayload", () => {
	it("normalizes names, secret references, and configuration", () => {
		expect(
			buildEventSinkPayload({
				...defaultEventSinkFormState,
				configInput: '{"url":"https://example.com/events"}',
				name: "  operations webhook  ",
				secretRef: "  event-webhook-secret  ",
			}),
		).toEqual({
			config: { url: "https://example.com/events" },
			enabled: true,
			kind: "webhook",
			name: "operations webhook",
			secret_ref: "event-webhook-secret",
		});
	});

	it("stores a blank secret reference as null", () => {
		expect(
			buildEventSinkPayload({
				...defaultEventSinkFormState,
				name: "mail",
			}),
		).toMatchObject({ secret_ref: null });
	});

	it("requires a name", () => {
		expect(() => buildEventSinkPayload(defaultEventSinkFormState)).toThrow(
			"Name is required.",
		);
	});
});

describe("eventSinkToFormState", () => {
	it("hydrates editable fields from an existing sink", () => {
		const sink: EventSink = {
			config: { stream: "events" },
			created_at: "2026-07-14T00:00:00Z",
			enabled: false,
			id: 7,
			kind: "valkey_stream",
			name: "stream sink",
			revision: 1,
			secret_ref: null,
			updated_at: "2026-07-14T00:00:00Z",
		};

		expect(eventSinkToFormState(sink)).toEqual({
			...defaultEventSinkFormState,
			configInput: '{\n  "stream": "events"\n}',
			enabled: false,
			kind: "valkey_stream",
			name: "stream sink",
			secretRef: "",
		});
	});
});

describe("webhook target setup", () => {
	it.each(["slack", "mattermost", "discord"] as const)(
		"saves %s as an ordinary webhook",
		(webhookTarget) => {
			const state = {
				...defaultEventSinkFormState,
				name: "Chat",
				webhookTarget,
				urlSecretRef: " ops_chat ",
				secretRef: "old-bearer",
			};
			const payload = buildEventSinkPayload(state);
			expect(payload).toMatchObject({
				kind: "webhook",
				secret_ref: null,
				delivery_policy: { min_interval_ms: 1000 },
				config: { url_secret_ref: "ops_chat" },
			});
			expect(payload).not.toHaveProperty("webhookTarget");
			expect(payload).not.toHaveProperty("target");
			expect(buildEventSinkPayload(customizeWebhookPreset(state))).toEqual(
				payload,
			);
		},
	);

	it.each(["", "https://hooks.slack.com/services/test", "a secret"])(
		"rejects invalid URL secret name %s",
		(urlSecretRef) => {
			expect(() =>
				buildEventSinkPayload({
					...defaultEventSinkFormState,
					name: "Chat",
					webhookTarget: "slack",
					urlSecretRef,
				}),
			).toThrow("secret name");
		},
	);

	it.each(["", "0", "-1", "1.5", "86400001", "NaN"])(
		"rejects invalid spacing %s",
		(deliveryIntervalInput) => {
			expect(() =>
				buildEventSinkPayload({
					...defaultEventSinkFormState,
					name: "Chat",
					webhookTarget: "discord",
					urlSecretRef: "chat",
					deliveryIntervalInput,
				}),
			).toThrow("Delivery spacing");
		},
	);

	it("preserves saved custom configuration and delivery policies on edit", () => {
		const sink: EventSink = {
			id: 1,
			name: "Custom chat",
			kind: "webhook",
			enabled: true,
			revision: 1,
			created_at: "2026-10-05",
			updated_at: "2026-10-05",
			config: {
				url_secret_ref: "chat",
				headers: { "X-Custom": "value" },
				body_template: '{"text":"custom"}',
			},
			delivery_policy: { min_interval_ms: 2500 },
			secret_ref: "bearer",
		};
		const state = eventSinkToFormState(sink);
		expect(state.webhookTarget).toBe("custom");
		expect(buildEventSinkPayload(state)).toMatchObject({
			config: sink.config,
			delivery_policy: sink.delivery_policy,
			secret_ref: "bearer",
		});
	});

	it("ignores a previous webhook preset when another transport is selected", () => {
		expect(
			buildEventSinkPayload({
				...defaultEventSinkFormState,
				name: "Mail",
				kind: "email",
				webhookTarget: "slack",
				configInput: '{"smtp_host":"mail.example.test"}',
			}),
		).toMatchObject({
			kind: "email",
			config: { smtp_host: "mail.example.test" },
		});
	});

	it.each([
		"[]",
		'"text"',
		"{",
		'{"min_interval_ms":"1000"}',
		'{"min_interval_ms":0}',
	])("rejects invalid custom delivery policy %s", (deliveryPolicyInput) => {
		expect(() =>
			buildEventSinkPayload({
				...defaultEventSinkFormState,
				name: "Chat",
				deliveryPolicyInput,
			}),
		).toThrow();
	});

	it("allows explicitly removing a delivery policy", () => {
		expect(
			buildEventSinkPayload({
				...defaultEventSinkFormState,
				name: "Chat",
				deliveryPolicyInput: "null",
			}).delivery_policy,
		).toBeNull();
	});
});
