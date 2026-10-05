import { describe, expect, it } from "vitest";
import type {
	CollectionEventSink,
	EventSink,
} from "@/lib/api/generated/models";
import {
	collectionWebhookConfig,
	webhookHasFixedDestination,
	webhookPresetConfig,
	webhookSubscriptionRouting,
	webhookUrlSecretRef,
} from "@/lib/webhook-presets";

describe("webhook provider contracts", () => {
	it.each(["slack", "mattermost"] as const)(
		"requires the %s acknowledgement and JSON-escaped text",
		(target) => {
			const config = webhookPresetConfig(target, "chat");
			expect(config.body_template).toBe(
				"{\"text\": {{ (test_marker ~ 'Hubuum: ' ~ summary) | tojson }}}",
			);
			expect(config.response).toEqual({
				success_statuses: [200],
				rate_limit: true,
				retry_statuses: [408, 500, 502, 503, 504],
				body: { kind: "text_equals", value: "ok" },
			});
		},
	);
	it("bounds Discord content, disables mentions and accepts its message response", () => {
		const config = webhookPresetConfig("discord", "chat");
		expect(config.body_template).toContain("[:1900] | tojson");
		expect(config.body_template).toContain('"allowed_mentions": {"parse": []}');
		expect(config.response.success_statuses).toEqual([200]);
		expect(config.response).not.toHaveProperty("body");
	});
});

describe("webhook subscription destinations", () => {
	const sink: EventSink = {
		id: 1,
		name: "Chat",
		kind: "webhook",
		enabled: true,
		revision: 1,
		created_at: "2026-10-05",
		updated_at: "2026-10-05",
		config: { url_secret_ref: "chat" },
	};
	it("uses the sink secret without sending stale routing URLs", () => {
		expect(webhookUrlSecretRef(sink)).toBe("chat");
		expect(
			webhookSubscriptionRouting(sink, "https://old.example.test"),
		).toEqual({});
	});
	it("preserves legacy subscription URLs when no sink destination exists", () => {
		expect(
			webhookSubscriptionRouting(
				{ ...sink, config: {} },
				" https://example.test ",
			),
		).toEqual({ url: "https://example.test" });
		expect(() =>
			webhookSubscriptionRouting({ ...sink, config: {} }, ""),
		).toThrow("Webhook URL is required");
	});
	it.each([null, [], 42, {}, { url_secret_ref: 12 }, { url_secret_ref: " " }])(
		"narrows untrusted configuration %j",
		(config) => {
			expect(webhookUrlSecretRef({ ...sink, config })).toBeNull();
		},
	);
	it("does not apply webhook routing to other transports", () => {
		expect(webhookUrlSecretRef({ ...sink, kind: "email" })).toBeNull();
	});
});

describe("collection-owned webhook destinations", () => {
	it.each(["custom", "slack", "mattermost", "discord"] as const)(
		"binds %s to the user's destination without a server secret",
		(target) => {
			const config = collectionWebhookConfig(
				target,
				"https://example.test/hooks/private",
			);
			expect(config.destination_url).toBe("https://example.test/hooks/private");
			expect(config).not.toHaveProperty("url_secret_ref");
		},
	);
	it.each([
		"http://example.test/hook",
		"https://user:password@example.test/hook",
	])("rejects unsafe URL %s", (url) => {
		expect(() => collectionWebhookConfig("custom", url)).toThrow();
	});
	it("recognizes a fixed destination from safe scoped discovery", () => {
		const sink: CollectionEventSink = {
			id: 1,
			name: "Chat",
			kind: "webhook",
			enabled: true,
			collection_id: 2,
			revision: 1,
			routing: "fixed",
		};
		expect(webhookHasFixedDestination(sink)).toBe(true);
		expect(
			webhookSubscriptionRouting(sink, "https://example.test/override"),
		).toEqual({});
	});
});
