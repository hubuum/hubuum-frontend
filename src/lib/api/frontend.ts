export const FRONTEND_API_PREFIX = "/_hubuum-bff";
export const HUBUUM_BFF_PREFIX = `${FRONTEND_API_PREFIX}/hubuum`;

export function frontendApiPath(path: string): string {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${FRONTEND_API_PREFIX}${normalizedPath}`;
}

export function hubuumBffPath(path: string): string {
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${HUBUUM_BFF_PREFIX}${normalizedPath}`;
}
