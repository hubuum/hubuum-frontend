import "server-only";

import { BackendError, backendFetchJson } from "@/lib/api/backend";
import type {
	CountsResponse,
	DbStateResponse,
	TaskQueueStateResponse,
} from "@/lib/api/generated/models";

export type CountsWithOptionalNamespaces = CountsResponse & {
	total_namespaces?: number;
};

export async function fetchMetaCounts(
	token: string,
	correlationId?: string,
): Promise<CountsWithOptionalNamespaces> {
	return backendFetchJson<CountsWithOptionalNamespaces>("/api/v0/meta/counts", {
		correlationId,
		token,
	});
}

export async function tryFetchMetaCounts(
	token: string,
	correlationId?: string,
): Promise<CountsWithOptionalNamespaces | null> {
	try {
		return await fetchMetaCounts(token, correlationId);
	} catch (error) {
		if (error instanceof BackendError && error.status === 403) {
			return null;
		}
		throw error;
	}
}

export async function fetchDbState(
	token: string,
	correlationId?: string,
): Promise<DbStateResponse> {
	return backendFetchJson<DbStateResponse>("/api/v0/meta/db", {
		correlationId,
		token,
	});
}

export async function fetchTaskQueueState(
	token: string,
	correlationId?: string,
): Promise<TaskQueueStateResponse> {
	return backendFetchJson<TaskQueueStateResponse>("/api/v0/meta/tasks", {
		correlationId,
		token,
	});
}

export type SystemMetaSnapshot = {
	counts: CountsWithOptionalNamespaces;
	db: DbStateResponse;
	tasks: TaskQueueStateResponse;
};

export async function tryFetchSystemMetaSnapshot(
	token: string,
	correlationId?: string,
): Promise<SystemMetaSnapshot | null> {
	try {
		const [counts, db, tasks] = await Promise.all([
			fetchMetaCounts(token, correlationId),
			fetchDbState(token, correlationId),
			fetchTaskQueueState(token, correlationId),
		]);

		return { counts, db, tasks };
	} catch (error) {
		if (
			error instanceof BackendError &&
			(error.status === 401 || error.status === 403)
		) {
			return null;
		}
		throw error;
	}
}

export function getTotalNamespaces(
	counts: CountsWithOptionalNamespaces,
): number {
	return typeof counts.total_namespaces === "number" &&
		Number.isFinite(counts.total_namespaces)
		? counts.total_namespaces
		: 0;
}
