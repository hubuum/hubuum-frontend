import { describe, expect, it } from "vitest";
import {
	ACCOUNT_SECTIONS,
	isAccountSectionActive,
} from "@/lib/account-sections";

describe("account sections", () => {
	it("keeps account navigation content in the product order", () => {
		expect(
			ACCOUNT_SECTIONS.map(({ href, hint, label }) => ({ href, hint, label })),
		).toEqual([
			{ href: "/account", label: "Profile", hint: "Identity" },
			{
				href: "/account/appearance",
				label: "Appearance",
				hint: "Interface",
			},
			{ href: "/account/tokens", label: "Tokens", hint: "Credentials" },
			{
				href: "/account/service-accounts",
				label: "Service accounts",
				hint: "Automation",
			},
			{ href: "/account/groups", label: "Groups", hint: "Membership" },
			{
				href: "/account/permissions",
				label: "Permissions",
				hint: "Access",
			},
		]);
	});

	it("matches nested routes without making Profile active everywhere", () => {
		expect(isAccountSectionActive("/account", "/account")).toBe(true);
		expect(
			isAccountSectionActive(
				"/account/service-accounts/42",
				"/account/service-accounts",
			),
		).toBe(true);
		expect(isAccountSectionActive("/account/tokens", "/account")).toBe(false);
	});
});
