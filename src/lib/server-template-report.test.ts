import { describe, expect, it, vi } from "vitest";

import {
	getStoredRawReport,
	parseBookmarkableReportFreshness,
	parseBookmarkableReportRequest,
	prepareBookmarkableTemplateReport,
	RawReportError,
	renderBookmarkableTemplateReport,
	renderFreshTemplateReport,
} from "@/lib/server-template-report";
import { InMemoryTemplateReportRunStore } from "@/lib/template-report-run-store";

function task(
	id: number,
	status: string,
	summary: string | null = null,
	httpStatus = 200,
	details: Record<string, unknown> = {},
) {
	return Response.json(
		{
			created_at: "2026-07-26T10:00:00.000Z",
			details,
			finished_at:
				status === "succeeded" || status === "partially_succeeded"
					? "2026-07-26T10:00:00.100Z"
					: null,
			id,
			status,
			summary,
		},
		{ status: httpStatus },
	);
}

function template(updatedAt = "2026-07-26T09:00:00.000Z") {
	return Response.json({
		kind: "export",
		updated_at: updatedAt,
	});
}

function completedTask(id: number, finishedAt = "2026-07-26T10:00:00.100Z") {
	return Response.json({
		created_at: "2026-07-26T10:00:00.000Z",
		details: {
			export: {
				output_available: true,
				output_expired: false,
			},
		},
		finished_at: finishedAt,
		id,
		status: "succeeded",
		summary: null,
	});
}

describe("bookmarkable report requests", () => {
	it("parses supported template overrides", () => {
		expect(
			parseBookmarkableReportRequest(
				new URLSearchParams({
					query: "name__icontains=edge&sort=name",
					object_id: "42",
					missing_data_policy: "omit",
					max_items: "25",
					max_output_bytes: "262144",
				}),
			),
		).toEqual({
			query: "name__icontains=edge&sort=name",
			object_id: 42,
			missing_data_policy: "omit",
			limits: {
				max_items: 25,
				max_output_bytes: 262_144,
			},
		});
	});

	it("treats an explicit empty query as clearing the template default", () => {
		expect(
			parseBookmarkableReportRequest(new URLSearchParams("query=")),
		).toEqual({
			query: null,
		});
	});

	it("rejects malformed numeric and policy overrides", () => {
		expect(() =>
			parseBookmarkableReportRequest(new URLSearchParams({ object_id: "1.5" })),
		).toThrowError(RawReportError);
		expect(() =>
			parseBookmarkableReportRequest(
				new URLSearchParams({ missing_data_policy: "warn" }),
			),
		).toThrowError("missing_data_policy must be strict, null, or omit.");
	});

	it("parses optional report freshness durations", () => {
		expect(
			parseBookmarkableReportFreshness(new URLSearchParams()),
		).toEqual({
			maxAgeMilliseconds: null,
		});
		expect(
			parseBookmarkableReportFreshness(
				new URLSearchParams({ max_age: "15m" }),
			),
		).toEqual({ maxAgeMilliseconds: 15 * 60 * 1000 });
		expect(
			parseBookmarkableReportFreshness(new URLSearchParams({ max_age: "0" })),
		).toEqual({ maxAgeMilliseconds: 0 });
		expect(() =>
			parseBookmarkableReportFreshness(
				new URLSearchParams({ max_age: "1.5h" }),
			),
		).toThrowError(RawReportError);
		expect(() =>
			parseBookmarkableReportFreshness(
				new URLSearchParams({ max_age: "366d" }),
			),
		).toThrowError("max_age cannot exceed 365d.");
	});
});

describe("raw template reports", () => {
	it("submits, polls, and returns the exact backend output body", async () => {
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(task(17, "queued", null, 202))
			.mockResolvedValueOnce(task(17, "running"))
			.mockResolvedValueOnce(task(17, "succeeded"))
			.mockResolvedValueOnce(
				new Response("<h1>Inventory</h1>\n", {
					headers: {
						"Content-Type": "text/html;charset=utf-8",
						"X-Hubuum-Export-Warnings": "0",
					},
				}),
			);

		const response = await renderFreshTemplateReport({
			correlationId: "correlation-123",
			request: { object_id: 9 },
			templateId: 7,
			token: "secret-token",
			dependencies: {
				backendFetch,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		});

		expect(backendFetch).toHaveBeenNthCalledWith(
			1,
			"/api/v1/export-templates/7/exports",
			expect.objectContaining({
				body: '{"object_id":9}',
				method: "POST",
				token: "secret-token",
			}),
		);
		expect(backendFetch).toHaveBeenLastCalledWith(
			"/api/v1/exports/17/output",
			expect.objectContaining({
				headers: { Accept: "*/*" },
				method: "GET",
			}),
		);
		await expect(response.text()).resolves.toBe("<h1>Inventory</h1>\n");
		expect(response.headers.get("Content-Type")).toBe(
			"text/html;charset=utf-8",
		);
		expect(response.headers.get("Content-Disposition")).toBe("inline");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(response.headers.get("Content-Security-Policy")).toContain(
			"sandbox",
		);
	});

	it("streams a stored task result without parsing or reformatting it", async () => {
		const source = '{  "items": [1, 2]  }\n';
		const backendFetch = vi.fn().mockResolvedValue(
			new Response(source, {
				headers: { "Content-Type": "application/json" },
			}),
		);

		const response = await getStoredRawReport({
			correlationId: "correlation-456",
			taskId: 19,
			token: "secret-token",
			dependencies: { backendFetch },
		});

		await expect(response.text()).resolves.toBe(source);
		expect(response.headers.get("Content-Security-Policy")).toBeNull();
	});

	it("stops after a failed task instead of repeatedly regenerating", async () => {
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(task(21, "queued", null, 202))
			.mockResolvedValueOnce(task(21, "failed", "Template rendering failed."));

		await expect(
			renderFreshTemplateReport({
				correlationId: "correlation-789",
				request: {},
				templateId: 8,
				token: "secret-token",
				dependencies: {
					backendFetch,
					sleep: vi.fn().mockResolvedValue(undefined),
				},
			}),
		).rejects.toMatchObject({
			message: "Template rendering failed.",
			status: 502,
		});
		expect(backendFetch).toHaveBeenCalledTimes(2);
	});

	it("reuses the latest available output for the same session and template revision", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(31, "queued", null, 202))
			.mockResolvedValueOnce(
				task(31, "succeeded", null, 200, {
					export: {
						output_available: true,
						output_expired: false,
					},
				}),
			)
			.mockResolvedValueOnce(
				new Response("generated", {
					headers: { "Content-Type": "text/plain" },
				}),
			)
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(completedTask(31))
			.mockResolvedValueOnce(
				new Response("generated", {
					headers: { "Content-Type": "text/plain" },
				}),
			);
		const options = {
			correlationId: "correlation-cache",
			freshness: { maxAgeMilliseconds: null },
			request: {},
			sessionId: "session-a",
			templateId: 7,
			token: "secret-token",
			dependencies: {
				backendFetch,
				now: () => Date.parse("2026-07-26T10:00:01.000Z"),
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		};

		const first = await renderBookmarkableTemplateReport(options);
		const second = await renderBookmarkableTemplateReport(options);

		await expect(first.text()).resolves.toBe("generated");
		await expect(second.text()).resolves.toBe("generated");
		expect(
			backendFetch.mock.calls.filter(([, request]) => request.method === "POST"),
		).toHaveLength(1);
	});

	it("prepares a fresh bookmarkable report without fetching its output", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(35, "queued", null, 202))
			.mockResolvedValueOnce(task(35, "succeeded"));

		await prepareBookmarkableTemplateReport({
			correlationId: "correlation-prepare",
			freshness: { maxAgeMilliseconds: 0 },
			request: {},
			sessionId: "session-prepare",
			templateId: 7,
			token: "secret-token",
			dependencies: {
				backendFetch,
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		});

		expect(backendFetch.mock.calls.map(([path]) => path)).toEqual([
			"/api/v1/export-templates/7",
			"/api/v1/export-templates/7/exports",
			"/api/v1/exports/35",
		]);
	});

	it("regenerates when max_age is exceeded and reuses the replacement", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(41, "queued", null, 202))
			.mockResolvedValueOnce(task(41, "succeeded"))
			.mockResolvedValueOnce(new Response("old"))
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(
				completedTask(41, "2026-07-26T09:00:00.000Z"),
			)
			.mockResolvedValueOnce(task(42, "queued", null, 202))
			.mockResolvedValueOnce(task(42, "succeeded"))
			.mockResolvedValueOnce(new Response("new"))
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(completedTask(42))
			.mockResolvedValueOnce(new Response("new"));
		const baseOptions = {
			correlationId: "correlation-stale",
			request: {},
			sessionId: "session-b",
			templateId: 8,
			token: "secret-token",
			dependencies: {
				backendFetch,
				now: () => Date.parse("2026-07-26T10:00:01.000Z"),
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		};

		await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: null },
		});
		const regenerated = await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: 15 * 60 * 1000 },
		});
		const reused = await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: 15 * 60 * 1000 },
		});

		await expect(regenerated.text()).resolves.toBe("new");
		await expect(reused.text()).resolves.toBe("new");
		expect(
			backendFetch.mock.calls.filter(([, request]) => request.method === "POST"),
		).toHaveLength(2);
	});

	it("forces regeneration with max_age=0 and invalidates reuse after a template update", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(51, "succeeded", null, 202))
			.mockResolvedValueOnce(new Response("first"))
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(52, "succeeded", null, 202))
			.mockResolvedValueOnce(new Response("forced"))
			.mockResolvedValueOnce(template("2026-07-26T11:00:00.000Z"))
			.mockResolvedValueOnce(task(53, "succeeded", null, 202))
			.mockResolvedValueOnce(new Response("updated"));
		const baseOptions = {
			correlationId: "correlation-force",
			request: {},
			sessionId: "session-c",
			templateId: 9,
			token: "secret-token",
			dependencies: {
				backendFetch,
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		};

		await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: null },
		});
		const forced = await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: 0 },
		});
		const updated = await renderBookmarkableTemplateReport({
			...baseOptions,
			freshness: { maxAgeMilliseconds: null },
		});

		await expect(forced.text()).resolves.toBe("forced");
		await expect(updated.text()).resolves.toBe("updated");
		expect(
			backendFetch.mock.calls.filter(([, request]) => request.method === "POST"),
		).toHaveLength(3);
	});

	it("regenerates when the remembered backend output has expired", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		const backendFetch = vi
			.fn()
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(task(61, "succeeded", null, 202))
			.mockResolvedValueOnce(new Response("old"))
			.mockResolvedValueOnce(template())
			.mockResolvedValueOnce(
				task(61, "succeeded", null, 200, {
					export: {
						output_available: false,
						output_expired: true,
					},
				}),
			)
			.mockResolvedValueOnce(task(62, "succeeded", null, 202))
			.mockResolvedValueOnce(new Response("replacement"));
		const baseOptions = {
			correlationId: "correlation-expired",
			freshness: { maxAgeMilliseconds: null },
			request: {},
			sessionId: "session-d",
			templateId: 10,
			token: "secret-token",
			dependencies: {
				backendFetch,
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		};

		await renderBookmarkableTemplateReport(baseOptions);
		const replacement = await renderBookmarkableTemplateReport(baseOptions);

		await expect(replacement.text()).resolves.toBe("replacement");
		expect(
			backendFetch.mock.calls.filter(([, request]) => request.method === "POST"),
		).toHaveLength(2);
	});

	it("coalesces concurrent first loads into one submitted export task", async () => {
		const runStore = new InMemoryTemplateReportRunStore();
		let submissions = 0;
		const backendFetch = vi.fn(
			async (path: string, request?: { method?: string }) => {
				if (path === "/api/v1/export-templates/11") {
					return template();
				}
				if (
					path === "/api/v1/export-templates/11/exports" &&
					request?.method === "POST"
				) {
					submissions += 1;
					return task(71, "queued", null, 202);
				}
				if (path === "/api/v1/exports/71") {
					return completedTask(71);
				}
				if (path === "/api/v1/exports/71/output") {
					return new Response("shared");
				}
				throw new Error(`Unexpected backend request: ${path}`);
			},
		);
		const options = {
			correlationId: "correlation-concurrent",
			freshness: { maxAgeMilliseconds: null },
			request: {},
			sessionId: "session-e",
			templateId: 11,
			token: "secret-token",
			dependencies: {
				backendFetch,
				runStore,
				sleep: vi.fn().mockResolvedValue(undefined),
			},
		};

		const [first, second] = await Promise.all([
			renderBookmarkableTemplateReport(options),
			renderBookmarkableTemplateReport(options),
		]);

		await expect(first.text()).resolves.toBe("shared");
		await expect(second.text()).resolves.toBe("shared");
		expect(submissions).toBe(1);
	});
});
