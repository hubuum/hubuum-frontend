import { afterEach, expect, it, vi } from "vitest";
import { fetchRelatedGraph } from "@/lib/api/related-graph";
afterEach(() => vi.unstubAllGlobals());
it("uses the bounded object graph endpoint through the BFF without cursor pagination", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			Response.json({
				objects: [
					{
						id: 8,
						name: "Root",
						description: "",
						hubuum_class_id: 3,
						path: [8],
					},
				],
				relations: [],
			}),
		);
	vi.stubGlobal("fetch", fetch);
	const controller = new AbortController();
	await fetchRelatedGraph(
		{ type: "object", classId: 3, objectId: 8 },
		{ depth: 2, limit: 50 },
		controller.signal,
	);
	expect(fetch).toHaveBeenCalledWith(
		"/_hubuum-bff/hubuum/api/v1/classes/3/objects/8/related/graph?depth__lte=2&limit=50",
		{ credentials: "include", signal: controller.signal },
	);
});
it("surfaces server bounds and authorization errors without an unbounded retry", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValue(
			Response.json(
				{ message: "Graph exceeds requested bound" },
				{ status: 400 },
			),
		);
	vi.stubGlobal("fetch", fetch);
	await expect(
		fetchRelatedGraph({ type: "class", classId: 3 }, { depth: 2, limit: 25 }),
	).rejects.toThrow("Graph exceeds requested bound");
	expect(fetch).toHaveBeenCalledTimes(1);
});
