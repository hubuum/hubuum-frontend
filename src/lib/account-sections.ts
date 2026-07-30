export const ACCOUNT_SECTIONS = [
	{ href: "/account", label: "Profile", hint: "Identity" },
	{ href: "/account/appearance", label: "Appearance", hint: "Interface" },
	{ href: "/account/tokens", label: "Tokens", hint: "Credentials" },
	{
		href: "/account/service-accounts",
		label: "Service accounts",
		hint: "Automation",
	},
	{ href: "/account/groups", label: "Groups", hint: "Membership" },
	{ href: "/account/permissions", label: "Permissions", hint: "Access" },
] as const;

export function isAccountSectionActive(
	pathname: string,
	href: (typeof ACCOUNT_SECTIONS)[number]["href"],
): boolean {
	return href === "/account"
		? pathname === "/account"
		: pathname === href || pathname.startsWith(`${href}/`);
}
