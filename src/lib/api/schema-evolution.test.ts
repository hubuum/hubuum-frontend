import { afterEach, describe, expect, it, vi } from "vitest";
import {
	activateSchema,
	fetchActiveSchema,
	fetchSchemaCompliance,
	fetchSchemaSummary,
	stageSchema,
	supportsSchemaRevisions,
} from "@/lib/api/schema-evolution";

afterEach(() => vi.unstubAllGlobals());
function mockResponse(data: unknown, status = 200) {
	const mock = vi.fn(
		async (_input: RequestInfo | URL, _init?: RequestInit) =>
			new Response(JSON.stringify(data), { status }),
	);
	vi.stubGlobal("fetch", mock);
	return mock;
}

describe("schema API boundary", () => {
	it("recognizes older servers returning a plain-text 404", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("Not found", { status: 404 })),
		);
		await expect(supportsSchemaRevisions(2)).resolves.toBe(false);
		await expect(fetchActiveSchema(2)).rejects.toMatchObject({ status: 404 });
	});
	it("uses the BFF and sends explicit activation identity and policy", async () => {
		const mock = mockResponse({ active: { revision: 4 } });
		const payload = {
			expected_active_revision: 3,
			policy: "reject_incompatible" as const,
			impact_task_id: 20,
		};
		await activateSchema(2, 4, payload);
		expect(mock).toHaveBeenCalledWith(
			"/_hubuum-bff/hubuum/api/v1/classes/2/schema/revisions/4/activate",
			expect.objectContaining({
				method: "POST",
				credentials: "include",
				body: JSON.stringify(payload),
			}),
		);
	});
	it("preserves HTTP conflicts for recovery without retrying activation", async () => {
		const mock = mockResponse({ message: "Population changed" }, 409);
		await expect(
			activateSchema(2, 4, {
				expected_active_revision: 3,
				policy: "allow_pending",
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(mock).toHaveBeenCalledTimes(1);
	});
	it("distinguishes unsupported schemas from denied access", async () => {
		mockResponse({}, 404);
		await expect(supportsSchemaRevisions(2)).resolves.toBe(false);
		mockResponse({}, 403);
		await expect(supportsSchemaRevisions(2)).rejects.toMatchObject({
			status: 403,
		});
		await expect(fetchSchemaSummary(2)).resolves.toBeNull();
	});
	it("keeps a compliance continuation even when no objects are visible", async () => {
		const mock = mockResponse({ items: [], next_after: 99 });
		await expect(fetchSchemaCompliance(2, 50, "pending")).resolves.toEqual({
			items: [],
			next_after: 99,
		});
		expect(mock.mock.calls[0][0]).toContain("after=50&limit=50&status=pending");
	});
	it("finds the active revision beyond the first history page", async () => {
		const mock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify(
						Array.from({ length: 50 }, (_, i) => ({
							revision: i + 1,
							status: "retired",
						})),
					),
				),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify([{ revision: 51, status: "active" }])),
			);
		vi.stubGlobal("fetch", mock);
		await expect(fetchActiveSchema(2)).resolves.toMatchObject({ revision: 51 });
		expect(mock.mock.calls[1][0]).toContain("after=50");
	});
	it("stages an explicit schema removal", async () => {
		const mock = mockResponse({ revision: 4 }, 201);
		await stageSchema(2, { json_schema: null, validate_schema: false });
		expect(mock).toHaveBeenCalledWith(
			expect.stringContaining("/schema/revisions"),
			expect.objectContaining({
				body: '{"json_schema":null,"validate_schema":false}',
			}),
		);
	});
});
