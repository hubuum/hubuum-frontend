"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
	{ href: "/account", label: "Profile" },
	{ href: "/account/tokens", label: "Tokens" },
	{ href: "/account/groups", label: "Groups" },
	{ href: "/account/permissions", label: "Permissions" },
];

export function AccountTabs() {
	const pathname = usePathname();

	return (
		<nav className="tab-strip" aria-label="Account sections">
			{TABS.map((tab) => {
				const active =
					tab.href === "/account"
						? pathname === "/account"
						: pathname === tab.href || pathname.startsWith(`${tab.href}/`);
				return (
					<Link
						key={tab.href}
						href={tab.href}
						className={active ? "tab tab--active" : "tab"}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
