const ROUTE_TITLES: Readonly<Record<string, string>> = {
	"/app": "Home",
	"/account": "Profile",
	"/account/appearance": "Appearance",
	"/account/tokens": "Tokens",
	"/account/service-accounts": "Service accounts",
	"/account/groups": "Groups",
	"/account/permissions": "Permissions",
	"/admin": "Administration",
	"/admin/users": "Users",
	"/admin/groups": "Groups",
	"/admin/service-accounts": "Service accounts",
	"/admin/remote-targets": "Remote targets",
	"/admin/events": "Events",
	"/admin/configuration": "Configuration",
	"/admin/backups": "Backup & restore",
	"/audit": "Audit",
	"/classes": "Classes",
	"/collections": "Collections",
	"/exports": "Exports",
	"/exports/templates/new": "New export template",
	"/imports": "Imports",
	"/objects": "Objects",
	"/relations": "Relations",
	"/relations/classes": "Class relations",
	"/relations/objects": "Object relations",
	"/search": "Search",
	"/statistics": "Statistics",
	"/tasks": "Tasks",
};

const DETAIL_ROUTE_TITLES: ReadonlyArray<{
	pattern: RegExp;
	label: (id: string) => string;
}> = [
	{ pattern: /^\/tasks\/(\d+)$/, label: (id) => `Task #${id}` },
	{ pattern: /^\/admin\/users\/(\d+)$/, label: (id) => `User #${id}` },
	{ pattern: /^\/admin\/groups\/(\d+)$/, label: (id) => `Group #${id}` },
	{
		pattern: /^\/admin\/service-accounts\/(\d+)$/,
		label: (id) => `Service account #${id}`,
	},
	{
		pattern: /^\/account\/service-accounts\/(\d+)$/,
		label: (id) => `Service account #${id}`,
	},
	{
		pattern: /^\/exports\/templates\/(\d+)$/,
		label: (id) => `Export template #${id}`,
	},
	{
		pattern: /^\/exports\/reports\/(\d+)$/,
		label: (id) => `Export report #${id}`,
	},
	{
		pattern: /^\/reports\/runs\/(\d+)$/,
		label: (id) => `Report run #${id}`,
	},
	{
		pattern: /^\/reports\/(\d+)$/,
		label: (id) => `Report #${id}`,
	},
];

export function getRouteTitle(pathname: string): string {
	const exactTitle = ROUTE_TITLES[pathname];
	if (exactTitle) {
		return exactTitle;
	}

	for (const route of DETAIL_ROUTE_TITLES) {
		const match = route.pattern.exec(pathname);
		if (match?.[1]) {
			return route.label(match[1]);
		}
	}

	if (pathname.startsWith("/collections/")) return "Collections";
	if (pathname.startsWith("/classes/")) return "Classes";
	if (pathname.startsWith("/objects/")) return "Objects";
	if (pathname.startsWith("/exports/")) return "Exports";
	if (pathname.startsWith("/relations/objects")) return "Object relations";
	if (pathname.startsWith("/relations")) return "Class relations";
	if (pathname.startsWith("/admin/")) return "Administration";
	if (pathname.startsWith("/account/")) return "Account";

	return "Home";
}

export function buildDocumentTitle(context: string | null | undefined): string {
	const normalizedContext = context?.trim();
	return normalizedContext ? `${normalizedContext} · Hubuum` : "Hubuum";
}
