import { getApiErrorMessage, expectArrayPayload } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import {
	postApiV1RemoteTargetsByTargetIdInvoke,
} from "@/lib/api/generated/client";
import type {
	RemoteInvocationSubject,
	RemoteTarget,
	RemoteTargetInvokeRequest,
	RemoteTargetSubjectType,
	TaskResponse,
} from "@/lib/api/generated/models";

export type RemoteTargetListPage = {
	nextCursor: string | null;
	targets: RemoteTarget[];
};

export type ListRemoteTargetsOptions = {
	cursor?: string;
	limit?: number;
	collectionId?: number;
	sort?: string;
};

export type RemoteInvocationPayload = {
	bodyOverride?: Record<string, unknown>;
	parameters?: Record<string, unknown>;
	subject: RemoteInvocationSubject;
};

function parseJsonPayload(response: Response): Promise<unknown> {
	return response.text().then((text) => {
		if (!text) {
			return null;
		}

		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	});
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value)
	);
}

export function parseJsonObjectInput(
	value: string,
	label: string,
): Record<string, unknown> {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error(`${label} must be valid JSON.`);
	}

	if (!isPlainObject(parsed)) {
		throw new Error(`${label} must be a JSON object.`);
	}

	return parsed;
}

export function filterInvokableTargets(
	targets: readonly RemoteTarget[],
	collectionId: number,
	subjectType: RemoteTargetSubjectType,
	classId?: number,
): RemoteTarget[] {
	return targets.filter(
		(target) =>
			target.enabled &&
			target.collection_id === collectionId &&
			target.allowed_subject_types.includes(subjectType) &&
			(subjectType !== "object" ||
				(typeof classId === "number" && target.class_id === classId)),
	);
}

export async function fetchRemoteTargetsPage(
	options: ListRemoteTargetsOptions = {},
): Promise<RemoteTargetListPage> {
	const params = new URLSearchParams();
	params.set("limit", String(options.limit ?? 100));
	params.set("sort", options.sort ?? "name.asc,id.asc");

	if (options.cursor?.trim()) {
		params.set("cursor", options.cursor.trim());
	}
	if (typeof options.collectionId === "number") {
		params.set("collection_id", String(options.collectionId));
	}

	const response = await fetch(
		`${hubuumBffPath("/api/v1/remote-targets")}?${params.toString()}`,
		{
			credentials: "include",
		},
	);
	const payload = await parseJsonPayload(response);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to load remote targets."),
		);
	}

	return {
		nextCursor: response.headers.get("x-next-cursor"),
		targets: expectArrayPayload<RemoteTarget>(payload, "remote targets"),
	};
}

export async function invokeRemoteTarget(
	targetId: number,
	payload: RemoteInvocationPayload,
	idempotencyKey?: string,
): Promise<TaskResponse> {
	const headers = new Headers();
	if (idempotencyKey?.trim()) {
		headers.set("Idempotency-Key", idempotencyKey.trim());
	}

	const request: RemoteTargetInvokeRequest = {
		subject: payload.subject,
		parameters: payload.parameters ?? {},
		body_override: payload.bodyOverride ?? {},
	};
	const response = await postApiV1RemoteTargetsByTargetIdInvoke(
		targetId,
		request,
		{
			credentials: "include",
			headers,
		},
	);

	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to invoke remote target."),
		);
	}

	return response.data;
}
