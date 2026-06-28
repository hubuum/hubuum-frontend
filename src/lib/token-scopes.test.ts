import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import { ALL_SCOPES, SCOPE_GROUPS } from "@/lib/token-scopes";

describe("token-scopes", () => {
	it("covers every Permissions value exactly once", () => {
		const grouped = SCOPE_GROUPS.flatMap((group) => group.scopes).sort();
		const all = Object.values(Permissions).sort();
		expect(grouped).toEqual(all);
	});

	it("exposes the flat list matching the enum", () => {
		expect([...ALL_SCOPES].sort()).toEqual(Object.values(Permissions).sort());
	});

	it("has no empty groups", () => {
		for (const group of SCOPE_GROUPS) {
			expect(group.scopes.length).toBeGreaterThan(0);
		}
	});
});
