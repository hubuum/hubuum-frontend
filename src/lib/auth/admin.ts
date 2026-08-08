import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";

export type AdminAccessProbe =
	| { status: "allowed"; response: Response }
	| { status: "forbidden" }
	| { status: "unauthorized" }
	| { status: "unavailable" };

export function discardAdminProbeResponse(response: Response): void {
	void response.body?.cancel().catch(() => {
		// The authorization decision is already known; body cleanup is best effort.
	});
}

export async function probeAdminAccess(
	token: string,
	correlationId?: string,
): Promise<AdminAccessProbe> {
	try {
		const response = await backendFetchRaw("/api/v0/meta/db", {
			correlationId,
			method: "GET",
			token,
		});

		if (response.status === 200) {
			return { status: "allowed", response };
		}

		discardAdminProbeResponse(response);
		if (response.status === 401 || response.status === 403) {
			console.info(
				`[hubuum-auth][cid=${correlationId ?? "-"}] admin access check denied status=${response.status}`,
			);
			return {
				status: response.status === 403 ? "forbidden" : "unauthorized",
			};
		}

		console.warn(
			`[hubuum-auth][cid=${correlationId ?? "-"}] admin access check failed status=${response.status}`,
		);
		return { status: "unavailable" };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(
			`[hubuum-auth][cid=${correlationId ?? "-"}] admin access check failed: ${message}`,
		);
		return { status: "unavailable" };
	}
}

export async function hasAdminAccess(
	token: string,
	correlationId?: string,
): Promise<boolean> {
	const probe = await probeAdminAccess(token, correlationId);
	if (probe.status !== "allowed") {
		return false;
	}

	discardAdminProbeResponse(probe.response);
	return true;
}
