import { describe, expect, it } from "vitest";

import { canManageCollectionPermissions } from "@/lib/collection-permission-access";

describe("collection permission management access", () => {
	it.each([
		{ canAdminister: true, hasDelegatedAccess: false, expected: true },
		{ canAdminister: false, hasDelegatedAccess: true, expected: true },
		{ canAdminister: true, hasDelegatedAccess: true, expected: true },
		{ canAdminister: false, hasDelegatedAccess: false, expected: false },
	])("returns $expected for admin=$canAdminister delegated=$hasDelegatedAccess", ({
		canAdminister,
		hasDelegatedAccess,
		expected,
	}) => {
		expect(
			canManageCollectionPermissions(canAdminister, hasDelegatedAccess),
		).toBe(expected);
	});
});
