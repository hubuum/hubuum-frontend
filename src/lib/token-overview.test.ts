import { describe, expect, it } from "vitest";
import type { MeResponse } from "@/lib/api/generated/models";
import { currentSessionToken } from "@/lib/token-overview";

const current: MeResponse = {
	principal: {
		principal_id: 7,
		name: "admin",
		kind: "human",
		identity_scope: "local",
		revision: 1,
		created_at: "2026-10-22T10:00:00Z",
		updated_at: "2026-10-22T10:00:00Z",
	},
	token: {
		id: 42,
		issued: "2026-10-22T10:00:00Z",
		expires_at: "2026-10-22T10:15:00Z",
		revision: 1,
		scope: { permissions: [], resources: [] },
	},
};

describe("current session in the token overview", () => {
	it("uses the authenticated token even when absent from the page, preserving scopes", () => {
		const token = currentSessionToken(current, "me");
		expect(token).toMatchObject({
			...current.token,
			principal_id: 7,
			active: true,
			expired: false,
		});
		expect(currentSessionToken(current, 7)).toEqual(token);
		expect(
			currentSessionToken(
				{ ...current, token: { ...current.token, id: 43 } },
				"me",
			)?.id,
		).toBe(43);
	});
	it("does not attribute the viewer's session to another principal", () => {
		expect(currentSessionToken(current, 8)).toBeNull();
		expect(currentSessionToken(undefined, "me")).toBeNull();
	});
});
