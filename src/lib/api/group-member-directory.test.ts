import { beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceAccounts, getUsers } = vi.hoisted(() => ({
	getServiceAccounts: vi.fn(),
	getUsers: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1IamServiceAccounts: getServiceAccounts,
	getApiV1IamUsers: getUsers,
}));

import { fetchGroupMemberDirectory } from "@/lib/api/group-member-directory";

function ok<T>(data: T, nextCursor: string | null = null) {
	const headers = new Headers();
	if (nextCursor) headers.set("x-next-cursor", nextCursor);
	return { data, headers, status: 200 };
}

describe("fetchGroupMemberDirectory", () => {
	beforeEach(() => {
		getUsers.mockReset();
		getServiceAccounts.mockReset();
	});

	it("searches users and service accounts by name without exact totals", async () => {
		getUsers.mockResolvedValue(
			ok([
				{
					email: "alice@example.com",
					id: 7,
					identity_scope: "local",
					name: "alice",
					proper_name: "Alice Example",
				},
			]),
		);
		getServiceAccounts.mockResolvedValue(
			ok(
				[
					{
						description: "Collects inventory",
						id: 19,
						identity_scope: "local",
						name: "alice-collector",
					},
				],
				"next",
			),
		);

		const directory = await fetchGroupMemberDirectory(" alice ");

		expect(getUsers).toHaveBeenCalledWith(
			expect.objectContaining({
				include_total: false,
				limit: 25,
				name__icontains: "alice",
				sort: "name.asc,id.asc",
			}),
			{ credentials: "include" },
		);
		expect(getServiceAccounts).toHaveBeenCalledTimes(1);
		expect(directory.candidates.map((candidate) => candidate.id)).toEqual([
			7, 19,
		]);
		expect(directory.isPartial).toBe(true);
		expect(directory.unavailableKinds).toEqual([]);
	});

	it("uses id__in for exact IDs and keeps partial results when one kind is forbidden", async () => {
		getUsers.mockResolvedValue(
			ok([
				{
					email: "alice@example.com",
					id: 7,
					identity_scope: "local",
					name: "alice",
					proper_name: "Alice Example",
				},
			]),
		);
		getServiceAccounts.mockRejectedValue(new Error("Forbidden"));

		const directory = await fetchGroupMemberDirectory("7");

		expect(getUsers).toHaveBeenCalledWith(
			expect.objectContaining({ id__in: "7" }),
			{ credentials: "include" },
		);
		expect(directory.candidates).toHaveLength(1);
		expect(directory.unavailableKinds).toEqual(["service_account"]);
	});
});
