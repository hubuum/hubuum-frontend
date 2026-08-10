import type {
	NewRemoteTarget,
	RemoteAuthConfig,
	RemoteHttpMethod,
	RemoteTarget,
	RemoteTargetSubjectType,
} from "@/lib/api/generated/models";
import { parseJsonObjectInput } from "@/lib/api/remote-targets";
import {
	assertRemoteTargetHeaderAllowed,
	validateRemoteTargetHeaders,
} from "@/lib/remote-target-headers";

export const REMOTE_TARGET_SUBJECT_TYPES: RemoteTargetSubjectType[] = [
	"collection",
	"class",
	"object",
	"class_relation",
	"object_relation",
];

type RemoteAuthType = RemoteAuthConfig["type"];

export type RemoteTargetFormState = {
	allowedSubjectTypes: RemoteTargetSubjectType[];
	authHeader: string;
	authSecret: string;
	authType: RemoteAuthType;
	authUsername: string;
	bodyTemplate: string;
	classId: string;
	description: string;
	enabled: boolean;
	headersTemplateInput: string;
	method: RemoteHttpMethod;
	name: string;
	collectionId: string;
	timeoutMs: string;
	urlTemplate: string;
};

export const defaultRemoteTargetFormState: RemoteTargetFormState = {
	allowedSubjectTypes: ["object"],
	authHeader: "X-API-Key",
	authSecret: "",
	authType: "none",
	authUsername: "",
	bodyTemplate: "",
	classId: "",
	description: "",
	enabled: true,
	headersTemplateInput: "{}",
	method: "post",
	name: "",
	collectionId: "",
	timeoutMs: "5000",
	urlTemplate: "https://example.com/{{ object.id }}",
};

function stringifyJson(value: unknown): string {
	return JSON.stringify(value ?? {}, null, 2) ?? "{}";
}

export function remoteTargetFormStateFromTarget(
	target: RemoteTarget,
): RemoteTargetFormState {
	const authConfig = target.auth_config;
	return {
		allowedSubjectTypes: [...target.allowed_subject_types],
		authHeader: "header" in authConfig ? authConfig.header : "X-API-Key",
		authSecret: "secret" in authConfig ? authConfig.secret : "",
		authType: authConfig.type,
		authUsername: "username" in authConfig ? authConfig.username : "",
		bodyTemplate: target.body_template ?? "",
		classId: target.class_id == null ? "" : String(target.class_id),
		description: target.description,
		enabled: target.enabled,
		headersTemplateInput: stringifyJson(target.headers_template),
		method: target.method,
		name: target.name,
		collectionId: String(target.collection_id),
		timeoutMs: String(target.timeout_ms),
		urlTemplate: target.url_template,
	};
}

export function buildRemoteTargetAuthConfig(
	state: RemoteTargetFormState,
): RemoteAuthConfig {
	if (state.authType === "none") return { type: "none" };

	const secret = state.authSecret.trim();
	if (!secret) throw new Error("Secret reference is required.");
	if (state.authType === "bearer_secret") {
		return { type: "bearer_secret", secret };
	}
	if (state.authType === "basic_secret") {
		const username = state.authUsername.trim();
		if (!username) {
			throw new Error("Basic authentication username is required.");
		}
		return { type: "basic_secret", secret, username };
	}

	const header = state.authHeader.trim();
	if (!header) throw new Error("API key header is required.");
	assertRemoteTargetHeaderAllowed(header, "API key authentication");
	return { type: "api_key_secret", header, secret };
}

export function validateRemoteTargetScope(state: RemoteTargetFormState): void {
	const collectionId = Number.parseInt(state.collectionId, 10);
	if (!Number.isFinite(collectionId) || collectionId < 1) {
		throw new Error("Collection is required.");
	}
	if (state.allowedSubjectTypes.length === 0) {
		throw new Error("Select at least one subject type.");
	}

	const classIdText = state.classId.trim();
	if (state.allowedSubjectTypes.includes("object")) {
		const classId = Number.parseInt(classIdText, 10);
		if (!Number.isFinite(classId) || classId < 1) {
			throw new Error("Class scope is required for object targets.");
		}
	} else if (classIdText) {
		throw new Error("Class scope is only valid for object targets.");
	}
}

export function validateRemoteTargetRequest(
	state: RemoteTargetFormState,
): void {
	if (!state.name.trim()) throw new Error("Name is required.");
	if (!state.description.trim()) throw new Error("Description is required.");
	if (!state.urlTemplate.trim()) throw new Error("URL template is required.");
	if (state.timeoutMs.trim()) {
		const timeoutMs = Number.parseInt(state.timeoutMs, 10);
		if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
			throw new Error("Timeout must be a positive integer.");
		}
	}
}

export function validateRemoteTargetTemplates(
	state: RemoteTargetFormState,
): void {
	const headers = parseJsonObjectInput(
		state.headersTemplateInput,
		"Headers template",
	);
	validateRemoteTargetHeaders(headers);
}

export function buildRemoteTargetPayload(
	state: RemoteTargetFormState,
): NewRemoteTarget {
	validateRemoteTargetScope(state);
	validateRemoteTargetRequest(state);
	validateRemoteTargetTemplates(state);
	const collectionId = Number.parseInt(state.collectionId, 10);
	const allowsObjects = state.allowedSubjectTypes.includes("object");
	const headersTemplate = parseJsonObjectInput(
		state.headersTemplateInput,
		"Headers template",
	);
	validateRemoteTargetHeaders(headersTemplate);

	const payload: NewRemoteTarget = {
		allowed_subject_types: [...state.allowedSubjectTypes],
		auth_config: buildRemoteTargetAuthConfig(state),
		class_id: allowsObjects ? Number.parseInt(state.classId.trim(), 10) : null,
		collection_id: collectionId,
		description: state.description.trim(),
		enabled: state.enabled,
		headers_template: headersTemplate,
		method: state.method,
		name: state.name.trim(),
		url_template: state.urlTemplate.trim(),
	};

	const bodyTemplate = state.bodyTemplate.trim();
	payload.body_template = bodyTemplate || null;

	const timeoutText = state.timeoutMs.trim();
	if (timeoutText) {
		payload.timeout_ms = Number.parseInt(timeoutText, 10);
	}

	return payload;
}

export function formatRemoteTargetSubjectTypes(
	subjectTypes: readonly RemoteTargetSubjectType[],
): string {
	return subjectTypes
		.map((subjectType) => subjectType.replaceAll("_", " "))
		.join(", ");
}
