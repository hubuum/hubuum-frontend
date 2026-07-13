import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";

export type VisibleWorkspaceSummary = {
	collections: number | null;
	classes: number | null;
	tasks: number | null;
};

function parseTotalCount(response: Response): number | null {
	if (!response.ok) return null;
	const value = response.headers.get("x-total-count");
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function fetchVisibleCount(
	path: string,
	token: string,
	correlationId?: string,
): Promise<number | null> {
	try {
		const response = await backendFetchRaw(path, { token, correlationId });
		return parseTotalCount(response);
	} catch {
		return null;
	}
}

export async function fetchVisibleWorkspaceSummary(
	token: string,
	correlationId?: string,
): Promise<VisibleWorkspaceSummary> {
	const [collections, classes, tasks] = await Promise.all([
		fetchVisibleCount(
			"/api/v1/collections?limit=1&include_total=true",
			token,
			correlationId,
		),
		fetchVisibleCount(
			"/api/v1/classes?limit=1&include_total=true",
			token,
			correlationId,
		),
		fetchVisibleCount(
			"/api/v1/tasks?limit=1&include_total=true",
			token,
			correlationId,
		),
	]);

	return { collections, classes, tasks };
}
