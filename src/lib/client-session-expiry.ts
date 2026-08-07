import { FRONTEND_API_PREFIX } from "@/lib/api/frontend";
import { normalizeReturnPath } from "@/lib/return-path";

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
	const returnTo = normalizeReturnPath(currentPath);
	return `/login?next=${encodeURIComponent(returnTo)}`;
}
