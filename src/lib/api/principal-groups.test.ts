import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentGroups, getPrincipalGroups } = vi.hoisted(() => ({
	getCurrentGroups: vi.fn(),
	getPrincipalGroups: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1IamMeGroups: getCurrentGroups,
	getApiV1IamPrincipalsByPrincipalIdGroups: getPrincipalGroups,
}));

import {
	fetchCurrentPrincipalGroups,
	fetchPrincipalGroups,
	hasAnyGroupMembership,
} from "@/lib/api/principal-groups";

function group(id: number, identityScope = "local") {
	return {
		created_at: "2026-08-30T12:00:00Z",
		description: "",
		groupname: `group-${id}`,
		id,
		identity_scope: identityScope,
		managed_by: identityScope,
		revision: 1,
		updated_at: "2026-08-30T12:00:00Z",
	};
}

describe("principal group loaders", () => {
	beforeEach(() => {
		getCurrentGroups.mockReset();
		getPrincipalGroups.mockReset();
	});

	it("loads more than 250 current memberships before access checks", async () => {
		const firstPage = Array.from({ length: 250 }, (_, index) => group(index + 1));
		const grantingGroup = group(251, "university");
		getCurrentGroups
			.mockResolvedValueOnce({
				data: firstPage,
				headers: new Headers({ "X-Next-Cursor": "membership-page-2" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [grantingGroup],
				headers: new Headers(),
				status: 200,
			});

		const groups = await fetchCurrentPrincipalGroups();

		expect(groups).toHaveLength(251);
		expect(groups.at(-1)?.identity_scope).toBe("university");
		expect(hasAnyGroupMembership(groups, [grantingGroup])).toBe(true);
		expect(getCurrentGroups).toHaveBeenNthCalledWith(
			1,
			{
				cursor: undefined,
				include_total: false,
				limit: 250,
				sort: "id.asc",
			},
			{ credentials: "include" },
		);
		expect(getCurrentGroups).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ cursor: "membership-page-2" }),
			{ credentials: "include" },
		);
	});

	it("loads every group for principal detail views and exports", async () => {
		getPrincipalGroups
			.mockResolvedValueOnce({
				data: [group(1)],
				headers: new Headers({ "X-Next-Cursor": "opaque/principal?next=1" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [group(2, "partner")],
				headers: new Headers(),
				status: 200,
			});

		await expect(fetchPrincipalGroups(42)).resolves.toEqual([
			group(1),
			group(2, "partner"),
		]);
		expect(getPrincipalGroups).toHaveBeenNthCalledWith(
			2,
			42,
			expect.objectContaining({ cursor: "opaque/principal?next=1" }),
			{ credentials: "include" },
		);
	});

	it("rejects a repeated membership cursor", async () => {
		getCurrentGroups
			.mockResolvedValueOnce({
				data: [group(1)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			})
			.mockResolvedValueOnce({
				data: [group(2)],
				headers: new Headers({ "X-Next-Cursor": "repeat" }),
				status: 200,
			});

		await expect(fetchCurrentPrincipalGroups()).rejects.toThrow(
			"repeated next cursor",
		);
	});
});
