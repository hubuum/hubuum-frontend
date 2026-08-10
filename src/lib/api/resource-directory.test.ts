import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchClassObjectDirectory } from "@/lib/api/resource-directory";

const objectPayload = [
	{
		collection_id: 3,
		created_at: "2026-08-10T10:00:00Z",
		data: {},
		description: "Edge node",
		hubuum_class_id: 12,
		id: 44,
		name: "edge-01",
		revision: 1,
		updated_at: "2026-08-10T10:00:00Z",
	},
];

describe("fetchClassObjectDirectory", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scopes name lookup to the selected class and omits exact totals", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify(objectPayload), {
				headers: { "x-next-cursor": "next" },
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const directory = await fetchClassObjectDirectory(12, " edge ");

		expect(fetchMock).toHaveBeenCalledWith(
			"/_hubuum-bff/classes/12/objects?include_total=false&limit=50&sort=name.asc%2Cid.asc&name__icontains=edge",
			{ credentials: "include" },
		);
		expect(directory.items).toEqual(objectPayload);
		expect(directory.isPartial).toBe(true);
	});

	it("uses id__in for an exact numeric lookup", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response("[]", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await fetchClassObjectDirectory(12, "44");

		expect(fetchMock).toHaveBeenCalledWith(
			"/_hubuum-bff/classes/12/objects?include_total=false&limit=50&sort=name.asc%2Cid.asc&id__in=44",
			{ credentials: "include" },
		);
	});
});
