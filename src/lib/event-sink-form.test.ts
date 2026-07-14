import { describe, expect, it } from "vitest";
import type { EventSink } from "@/lib/api/generated/models";
import {
	buildEventSinkPayload,
	defaultEventSinkFormState,
	eventSinkToFormState,
	parseEventSinkConfig,
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
			secret_ref: null,
			updated_at: "2026-07-14T00:00:00Z",
		};

		expect(eventSinkToFormState(sink)).toEqual({
			configInput: '{\n  "stream": "events"\n}',
			enabled: false,
			kind: "valkey_stream",
			name: "stream sink",
			secretRef: "",
		});
	});
});
