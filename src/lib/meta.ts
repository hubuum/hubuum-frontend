import "server-only";

import { BackendError, backendFetchJson } from "@/lib/api/backend";
import type {
	CountsResponse,
	DbStateResponse,
	RunningConfig,
	TaskQueueStateResponse,
} from "@/lib/api/generated/models";

export type CountsWithOptionalCollections = CountsResponse & {
	total_collections?: number;
};

export async function fetchMetaCounts(
	token: string,
	correlationId?: string,
): Promise<CountsWithOptionalCollections> {
	return backendFetchJson<CountsWithOptionalCollections>(
		"/api/v0/meta/counts",
		{
			correlationId,
			token,
		},
	);
}

export async function tryFetchMetaCounts(
	token: string,
	correlationId?: string,
): Promise<CountsWithOptionalCollections | null> {
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

export async function fetchRunningConfig(
	token: string,
	correlationId?: string,
): Promise<RunningConfig> {
	return backendFetchJson<RunningConfig>("/api/v1/admin/config", {
		correlationId,
		token,
	});
}

export async function tryFetchRunningConfig(
	token: string,
	correlationId?: string,
): Promise<RunningConfig | null> {
	try {
		return await fetchRunningConfig(token, correlationId);
	} catch (error) {
		if (
			error instanceof BackendError &&
			(error.status === 401 || error.status === 403 || error.status === 404)
		) {
			return null;
		}
		throw error;
	}
}

export type SystemMetaSnapshot = {
	counts: CountsWithOptionalCollections;
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

export function getTotalCollections(
	counts: CountsWithOptionalCollections,
): number {
	return typeof counts.total_collections === "number" &&
		Number.isFinite(counts.total_collections)
		? counts.total_collections
		: 0;
}
