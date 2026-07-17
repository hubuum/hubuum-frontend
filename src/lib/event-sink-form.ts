import type {
	EventSink,
	EventSinkKind,
	NewEventSink,
} from "@/lib/api/generated/models";

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
};

export const defaultEventSinkFormState: EventSinkFormState = {
	configInput: "{}",
	enabled: true,
	kind: "webhook",
	name: "",
	secretRef: "",
};

function stringifyJson(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2) ?? "{}";
}

export function eventSinkToFormState(sink: EventSink): EventSinkFormState {
	return {
		configInput: stringifyJson(sink.config),
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

	return {
		config: parseEventSinkConfig(state.configInput),
		enabled: state.enabled,
		kind: state.kind,
		name,
		secret_ref: state.secretRef.trim() || null,
	};
}
