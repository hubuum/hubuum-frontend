import { FRONTEND_API_PREFIX } from "@/lib/api/frontend";
import { normalizeReturnPath } from "@/lib/return-path";

export const SESSION_EXPIRED_ERROR_CODE = "session_expired";
const AUTH_API_PREFIX = `${FRONTEND_API_PREFIX}/auth/`;

const restoreMonitors = new Set<symbol>();

// Keep the in-memory restore capability available while database replacement
// invalidates sessions. Server authorization remains enforced on every request.
export function deferSessionExpiryForRestore(): () => void {
	const monitor = Symbol();
	restoreMonitors.add(monitor);
	return () => {
		restoreMonitors.delete(monitor);
	};
}

export function isMonitoringRestore(): boolean {
	return restoreMonitors.size > 0;
}

export function isSessionExpiryResponse(
	requestUrl: URL,
	status: number,
): boolean {
	return (
		status === 401 &&
		requestUrl.pathname.startsWith(`${FRONTEND_API_PREFIX}/`) &&
		!requestUrl.pathname.startsWith(AUTH_API_PREFIX)
	);
}

export function buildSessionExpiryLoginPath(currentPath: string): string {
	const searchParams = new URLSearchParams({
		error: SESSION_EXPIRED_ERROR_CODE,
		next: normalizeReturnPath(currentPath),
	});
	return `/login?${searchParams.toString()}`;
}
