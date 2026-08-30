import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGroups } = vi.hoisted(() => ({
	getGroups: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1IamGroups: getGroups,
}));

import {
	fetchGroupDirectory,
	fetchGroupsByIds,
} from "@/lib/api/group-directory";

describe("fetchGroupDirectory", () => {
	beforeEach(() => {
		getGroups.mockReset();
	});

	it("uses name filters without requesting exact totals", async () => {
		getGroups.mockResolvedValue({
			data: [],
			headers: new Headers({ "x-next-cursor": "next" }),
			status: 200,
		});

		const directory = await fetchGroupDirectory(" operators ");

		expect(getGroups).toHaveBeenCalledWith(
			expect.objectContaining({
				include_total: false,
				limit: 50,
				name__icontains: "operators",
				sort: "name.asc,id.asc",
			}),
			{ credentials: "include" },
		);
		expect(directory.isPartial).toBe(true);
	});

	it("uses id__in for an exact numeric lookup", async () => {
		getGroups.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});

		await fetchGroupDirectory("17");

		expect(getGroups).toHaveBeenCalledWith(
			expect.objectContaining({ id__in: "17" }),
			{ credentials: "include" },
		);
	});

	it("batches group enrichment by ID", async () => {
		getGroups.mockImplementation((params: { id__in?: string }) => {
			return Promise.resolve({
				data:
					params.id__in === "251" ? [{ id: 251, groupname: "group-251" }] : [],
				headers: new Headers(),
				status: 200,
			});
		});
		const ids = Array.from({ length: 251 }, (_, index) => index + 1);

		const groups = await fetchGroupsByIds(ids);

		expect(getGroups).toHaveBeenCalledTimes(2);
		expect(getGroups).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				id__in: ids.slice(0, 250).join(","),
				limit: 250,
			}),
			{ credentials: "include" },
		);
		expect(getGroups).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ id__in: "251", limit: 1 }),
			{ credentials: "include" },
		);
		expect(groups).toContainEqual({ id: 251, groupname: "group-251" });
	});
});
