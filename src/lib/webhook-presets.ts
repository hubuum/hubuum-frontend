import type { EventSink } from "@/lib/api/generated/models";

export const WEBHOOK_TARGETS = [
	"custom",
	"slack",
	"mattermost",
	"discord",
] as const;
export type WebhookTarget = (typeof WEBHOOK_TARGETS)[number];
export type WebhookPreset = Exclude<WebhookTarget, "custom">;

export const WEBHOOK_TARGET_LABELS: Record<WebhookTarget, string> = {
	custom: "Custom webhook",
	slack: "Slack",
	mattermost: "Mattermost",
	discord: "Discord",
};

// Match the released server recipes. The target is a UI choice, never an API field.
export function webhookPresetConfig(
	target: WebhookPreset,
	urlSecretRef: string,
) {
	return {
		url_secret_ref: urlSecretRef.trim(),
		body_template:
			target === "discord"
				? '{"content": {{ (test_marker ~ \'Hubuum: \' ~ summary)[:1900] | tojson }}, "allowed_mentions": {"parse": []}}'
				: "{\"text\": {{ (test_marker ~ 'Hubuum: ' ~ summary) | tojson }}}",
		response: {
			success_statuses: [200],
			rate_limit: true,
			retry_statuses: [408, 500, 502, 503, 504],
			...(target === "discord"
				? {}
				: { body: { kind: "text_equals", value: "ok" } }),
		},
	};
}

export function webhookUrlSecretRef(
	sink: Pick<EventSink, "kind" | "config"> | undefined,
): string | null {
	const config = sink?.config;
	if (
		sink?.kind !== "webhook" ||
		!config ||
		typeof config !== "object" ||
		Array.isArray(config)
	)
		return null;
	return "url_secret_ref" in config && typeof config.url_secret_ref === "string"
		? config.url_secret_ref.trim() || null
		: null;
}

export function webhookSubscriptionRouting(
	sink: EventSink | undefined,
	url: string,
): Record<string, string> {
	if (webhookUrlSecretRef(sink)) return {};
	if (!url.trim()) throw new Error("Webhook URL is required.");
	return { url: url.trim() };
}
