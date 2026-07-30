"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	ACCOUNT_SECTIONS,
	isAccountSectionActive,
} from "@/lib/account-sections";

export function AccountTabs() {
	const pathname = usePathname();

	return (
		<nav className="account-section-nav" aria-label="Account sections">
			{ACCOUNT_SECTIONS.map((tab, index) => {
				const active = isAccountSectionActive(pathname, tab.href);
				return (
					<Link
						key={tab.href}
						href={tab.href}
						prefetch={false}
						className={
							active
								? "account-section-link is-active"
								: "account-section-link"
						}
						aria-current={active ? "page" : undefined}
					>
						<span className="account-section-index" aria-hidden="true">
							{String(index + 1).padStart(2, "0")}
						</span>
						<span className="account-section-copy">
							<strong>{tab.label}</strong>
							<small>{tab.hint}</small>
						</span>
					</Link>
				);
			})}
		</nav>
	);
}
