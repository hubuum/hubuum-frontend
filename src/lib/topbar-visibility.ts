const COMPACT_TOPBAR_ROUTE_PREFIXES = [
	"/app",
	"/search",
	"/account",
	"/imports",
	"/exports",
	"/tasks",
	"/admin/events",
	"/admin/configuration",
	"/admin/backups",
	"/audit",
	"/statistics",
] as const;

export function usesCompactTopbar(pathname: string): boolean {
	if (
		/^\/objects\/\d+\/\d+$/.test(pathname) ||
		/^\/classes\/\d+$/.test(pathname) ||
		/^\/collections\/\d+$/.test(pathname)
	) {
		return true;
	}

	return COMPACT_TOPBAR_ROUTE_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}
