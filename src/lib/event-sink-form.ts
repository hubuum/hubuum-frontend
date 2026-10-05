import type {
	EventSink,
	EventSinkKind,
	NewEventSink,
	EventDeliveryPolicy,
} from "@/lib/api/generated/models";
import {
	webhookPresetConfig,
	webhookUrlSecretRef,
	type WebhookTarget,
} from "@/lib/webhook-presets";

export const EVENT_SINK_KINDS: EventSinkKind[] = [
	"webhook",
	"amqp",
	"valkey_stream",
	"email",
];

export type EventSinkFormState = {
	configInput: string;
	enabled: boolean;
	kind: EventSinkKind;
	name: string;
	secretRef: string;
	webhookTarget: WebhookTarget;
	urlSecretRef: string;
	deliveryIntervalInput: string;
	deliveryPolicyInput: string;
};

export const defaultEventSinkFormState: EventSinkFormState = {
	configInput: "{}",
	enabled: true,
	kind: "webhook",
	name: "",
	secretRef: "",
	webhookTarget: "custom",
	urlSecretRef: "",
	deliveryIntervalInput: "1000",
	deliveryPolicyInput: "",
};

function stringifyJson(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2) ?? "{}";
}

export function eventSinkToFormState(sink: EventSink): EventSinkFormState {
	return {
		...defaultEventSinkFormState,
		configInput: stringifyJson(sink.config),
		urlSecretRef: webhookUrlSecretRef(sink) ?? "",
		deliveryPolicyInput:
			sink.delivery_policy == null ? "" : stringifyJson(sink.delivery_policy),
		enabled: sink.enabled,
		kind: sink.kind,
		name: sink.name,
		secretRef: sink.secret_ref ?? "",
	};
}

export function parseEventSinkConfig(value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}

	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		throw new Error("Configuration must be valid JSON.");
	}
}

export function buildEventSinkPayload(state: EventSinkFormState): NewEventSink {
	const name = state.name.trim();
	if (!name) {
		throw new Error("Name is required.");
	}

	const preset = state.kind === "webhook" && state.webhookTarget !== "custom";
	if (
		preset &&
		(!state.urlSecretRef.trim() || /[\s:/]/.test(state.urlSecretRef.trim()))
	) {
		throw new Error(
			"Enter the webhook URL's secret name, not the URL or secret value.",
		);
	}
	const deliveryPolicy = preset
		? { min_interval_ms: Number(state.deliveryIntervalInput) }
		: parseDeliveryPolicy(state.deliveryPolicyInput);
	if (
		deliveryPolicy?.min_interval_ms != null &&
		(!Number.isInteger(deliveryPolicy.min_interval_ms) ||
			deliveryPolicy.min_interval_ms < 1 ||
			deliveryPolicy.min_interval_ms > 86_400_000)
	) {
		throw new Error(
			"Delivery spacing must be a whole number from 1 to 86400000 milliseconds.",
		);
	}
	return {
		config:
			preset && state.webhookTarget !== "custom"
				? webhookPresetConfig(state.webhookTarget, state.urlSecretRef)
				: parseEventSinkConfig(state.configInput),
		...(deliveryPolicy !== undefined
			? { delivery_policy: deliveryPolicy }
			: {}),
		enabled: state.enabled,
		kind: state.kind,
		name,
		secret_ref: preset ? null : state.secretRef.trim() || null,
	};
}

function parseDeliveryPolicy(
	value: string,
): EventDeliveryPolicy | null | undefined {
	if (!value.trim()) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("Delivery policy must be valid JSON.");
	}
	if (parsed === null) return null;
	if (typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("Delivery policy must be an object or null.");
	if (
		"min_interval_ms" in parsed &&
		parsed.min_interval_ms != null &&
		typeof parsed.min_interval_ms !== "number"
	) {
		throw new Error("Delivery spacing must be a number of milliseconds.");
	}
	return parsed as EventDeliveryPolicy;
}

export function customizeWebhookPreset(
	state: EventSinkFormState,
): EventSinkFormState {
	if (state.webhookTarget === "custom") return state;
	return {
		...state,
		webhookTarget: "custom",
		configInput: stringifyJson(
			webhookPresetConfig(state.webhookTarget, state.urlSecretRef),
		),
		deliveryPolicyInput: stringifyJson({
			min_interval_ms: Number(state.deliveryIntervalInput),
		}),
		secretRef: "",
	};
}
