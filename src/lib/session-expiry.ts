import { FRONTEND_API_PREFIX } from "@/lib/api/frontend";
import { normalizeReturnPath } from "@/lib/return-path";

export const SESSION_EXPIRED_ERROR_CODE = "session_expired";
const AUTH_API_PREFIX = `${FRONTEND_API_PREFIX}/auth/`;

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
