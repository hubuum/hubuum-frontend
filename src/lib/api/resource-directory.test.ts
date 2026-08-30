import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getClasses, getCollections } = vi.hoisted(() => ({
	getClasses: vi.fn(),
	getCollections: vi.fn(),
}));

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1Classes: getClasses,
	getApiV1Collections: getCollections,
}));

import {
	fetchClassDirectory,
	fetchClassObjectDirectory,
	fetchClassesByIds,
	fetchCollectionClassDirectory,
	fetchCollectionDirectory,
	fetchCollectionsByIds,
} from "@/lib/api/resource-directory";

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
	beforeEach(() => {
		getClasses.mockReset();
		getCollections.mockReset();
	});

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

	it("uses exact ID filters for class and collection lookups", async () => {
		getCollections.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});

		await fetchCollectionDirectory(" 44 ");
		getClasses.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});
		await fetchClassDirectory("251");

		expect(getCollections).toHaveBeenCalledWith(
			expect.objectContaining({
				id__in: "44",
				include_total: false,
				limit: 50,
				sort: "name.asc,id.asc",
			}),
			{ credentials: "include" },
		);
		expect(getClasses).toHaveBeenCalledWith(
			expect.objectContaining({
				id__in: "251",
				include_total: false,
				limit: 50,
			}),
			{ credentials: "include" },
		);
	});

	it("searches classes by name and scopes dependent class lookups", async () => {
		getClasses.mockResolvedValue({
			data: [],
			headers: new Headers({ "x-next-cursor": "next" }),
			status: 200,
		});

		const directory = await fetchClassDirectory(" edge ");
		await fetchCollectionClassDirectory(7, "edge");

		expect(getClasses).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ name__icontains: "edge" }),
			{ credentials: "include" },
		);
		expect(getClasses).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				collection_id: 7,
				name__icontains: "edge",
			}),
			{ credentials: "include" },
		);
		expect(directory.isPartial).toBe(true);
	});

	it("batches ID enrichment at the server page limit", async () => {
		getCollections.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});
		getClasses.mockImplementation((params: { id__in?: string }) => {
			return Promise.resolve({
				data:
					params.id__in === "251"
						? [{ id: 251, name: "class-251" }]
						: [],
				headers: new Headers(),
				status: 200,
			});
		});
		const ids = Array.from({ length: 251 }, (_, index) => index + 1);

		await fetchCollectionsByIds(ids);
		const classes = await fetchClassesByIds(ids);

		expect(getCollections).toHaveBeenCalledTimes(2);
		expect(getCollections).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				id__in: ids.slice(0, 250).join(","),
				limit: 250,
			}),
			{ credentials: "include" },
		);
		expect(getCollections).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ id__in: "251", limit: 1 }),
			{ credentials: "include" },
		);
		expect(getClasses).toHaveBeenCalledTimes(2);
		expect(getClasses).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				id__in: ids.slice(0, 250).join(","),
				limit: 250,
			}),
			{ credentials: "include" },
		);
		expect(getClasses).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ id__in: "251", limit: 1 }),
			{ credentials: "include" },
		);
		expect(classes).toContainEqual({ id: 251, name: "class-251" });
	});
});
