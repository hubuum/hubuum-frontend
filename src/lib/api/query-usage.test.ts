import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	QueryUsagePatternSchema,
	QueryUsageResponse,
} from "@/lib/api/generated/models";
import {
	analyzeQueryUsage,
	createQueryUsage,
	deleteQueryUsage,
	fetchQueryUsage,
	replaceQueryUsage,
} from "@/lib/api/query-usage";

const pattern: QueryUsagePatternSchema = {
	path: "serial",
	value_type: "string",
	operations: ["equals"],
};
const declaration: QueryUsageResponse = {
	class_id: 10,
	id: 3,
	revision: 7,
	pattern,
	schema_compatibility: "unknown",
	created_at: "2026-10-18T10:00:00Z",
	updated_at: "2026-10-18T10:00:00Z",
};
const path = "/_hubuum-bff/hubuum/api/v1/classes/10/query-usage";

afterEach(() => vi.unstubAllGlobals());
function mockResponse(data: unknown, status = 200) {
	const fetch = vi.fn(
		async () =>
			new Response(status === 204 ? null : JSON.stringify(data), { status }),
	);
	vi.stubGlobal("fetch", fetch);
	return fetch;
}

describe("query usage API", () => {
	it("preserves unsupported and forbidden responses from older plain-text servers", async () => {
		for (const status of [403, 404]) {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response("Unavailable", { status })),
			);
			await expect(fetchQueryUsage(10)).rejects.toMatchObject({ status });
			await expect(analyzeQueryUsage(10, [])).rejects.toMatchObject({ status });
		}
	});
	it("reads through the BFF and forwards cancellation", async () => {
		const fetch = mockResponse([declaration]);
		const signal = new AbortController().signal;
		expect(await fetchQueryUsage(10, signal)).toEqual([declaration]);
		expect(fetch).toHaveBeenCalledWith(
			path,
			expect.objectContaining({
				credentials: "include",
				signal,
				method: "GET",
			}),
		);
	});
	it("creates intent separately from read-only hypothetical analysis", async () => {
		const create = mockResponse(declaration, 201);
		await createQueryUsage(10, pattern);
		expect(create).toHaveBeenCalledWith(
			path,
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ pattern }),
			}),
		);
		const analyze = mockResponse({ status: "unavailable" });
		await analyzeQueryUsage(10, [pattern]);
		expect(analyze).toHaveBeenCalledWith(
			`${path}/analysis`,
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify({ proposed: [pattern] }),
			}),
		);
		expect(analyze).toHaveBeenCalledTimes(1);
	});
	it("sends the revision that the user reviewed for replacements and withdrawals", async () => {
		const update = mockResponse(declaration);
		await replaceQueryUsage(10, declaration, pattern);
		expect(update).toHaveBeenCalledWith(
			`${path}/3`,
			expect.objectContaining({
				method: "PUT",
				body: JSON.stringify({ pattern, expected_revision: 7 }),
			}),
		);
		const remove = mockResponse(null, 204);
		await deleteQueryUsage(10, declaration);
		expect(remove).toHaveBeenCalledWith(
			`${path}/3?expected_revision=7`,
			expect.objectContaining({ method: "DELETE", credentials: "include" }),
		);
	});
	it.each([400, 403, 404, 409, 503])(
		"preserves status %s and diagnostics without retrying a write",
		async (status) => {
			const fetch = mockResponse(
				{ message: "Cannot change declaration" },
				status,
			);
			await expect(
				replaceQueryUsage(10, declaration, pattern),
			).rejects.toMatchObject({ status, message: "Cannot change declaration" });
			expect(fetch).toHaveBeenCalledTimes(1);
		},
	);
});
