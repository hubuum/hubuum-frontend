import { expect, test } from "@playwright/test";
import {
	advancedSearchUrl,
	emptySearchDraft,
	type SearchTarget,
} from "@/lib/advanced-search";
const prefix = "/_hubuum-bff/hubuum/api/v1";
const collection = {
	id: 7,
	name: "Streamed collection",
	description: "",
	updated_at: "2026-10-01T00:00:00Z",
	created_at: "2026-10-01T00:00:00Z",
	revision: 1,
	parent_collection_id: null,
};
function queryUrl(target: SearchTarget) {
	const draft = emptySearchDraft();
	draft.target = target;
	draft.sort = [{ field: "id", direction: "asc" }];
	draft.filter = {
		id: "root",
		kind: "field",
		negate: false,
		condition: {
			field: "id",
			operator: "gte",
			path: "",
			valueType: "number",
			values: ["1"],
		},
	};
	return advancedSearchUrl(draft);
}
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires disposable authenticated backend",
	);
	await page.goto("/login");
	expect(
		(
			await page.request.post("/_hubuum-bff/auth/login", {
				headers: { Origin: new URL(page.url()).origin },
				data: {
					username: process.env.E2E_USERNAME ?? "admin",
					password: process.env.E2E_PASSWORD,
					identity_scope: "local",
				},
			})
		).status(),
	).toBe(200);
});
for (const structured of [false, true]) {
	test(`${structured ? "structured" : "ordinary"} streaming shows partial results, cancels, and restarts explicitly`, async ({
		page,
	}) => {
		await page.addInitScript(
			({ collection, prefix }) => {
				const original = window.fetch;
				window.fetch = async (input, init) => {
					const url =
						typeof input === "string"
							? input
							: input instanceof URL
								? input.href
								: input.url;
					if (!url.includes(`${prefix}/search/stream`))
						return original(input, init);
					const structured = init?.method === "POST";
					const encode = (event: string, data: unknown) =>
						new TextEncoder().encode(
							`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
						);
					let streamController: ReadableStreamDefaultController<Uint8Array>;
					let closed = false;
					const finish = () => {
						if (closed) return;
						streamController.enqueue(
							encode(
								"done",
								structured
									? {
											version: 1,
											kind: "collection",
											next: null,
											total: 1,
											page_limit: 25,
										}
									: { query: "Streamed" },
							),
						);
						streamController.close();
						closed = true;
					};
					window.addEventListener("finish-search", finish, { once: true });
					const stream = new ReadableStream<Uint8Array>({
						start(controller) {
							streamController = controller;
							controller.enqueue(
								encode(
									"started",
									structured
										? { version: 1, kind: "collection" }
										: { query: "Streamed" },
								),
							);
							controller.enqueue(
								encode(
									structured ? "result" : "batch",
									structured
										? { kind: "collection", resource: collection }
										: {
												kind: "collections",
												collections: [collection],
												classes: [],
												objects: [],
												next: "not-yet-usable",
											},
								),
							);
						},
						cancel() {
							closed = true;
							window.removeEventListener("finish-search", finish);
						},
					});
					return new Response(stream, {
						headers: { "content-type": "text/event-stream" },
					});
				};
			},
			{ collection, prefix },
		);
		await page.goto(
			structured
				? queryUrl("collection")
				: "/search?q=Streamed&kinds=collection&stream=true",
		);
		if (structured) {
			await page.getByLabel("Stream results", { exact: true }).check();
			await page
				.getByRole("button", { name: "Run search", exact: true })
				.click();
		}
		await expect(
			page.getByRole("link", { name: /Streamed collection/ }),
		).toBeVisible();
		await expect(page.getByText(/This page is incomplete/)).toBeVisible();
		await page
			.getByRole("button", { name: "Cancel search", exact: true })
			.click();
		await expect(
			page.getByText("Search cancelled. Received results are incomplete."),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /Streamed collection/ }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Restart search", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Cancel search", exact: true }),
		).toBeVisible();
		await page.evaluate(() => window.dispatchEvent(new Event("finish-search")));
		await expect(
			page.getByRole("button", { name: "Cancel search", exact: true }),
		).toHaveCount(0);
		await expect(page.getByText(/This page is incomplete/)).toHaveCount(0);
	});
}
test("terminal streaming errors retain partial results and never retry automatically", async ({
	page,
}) => {
	const requests: string[] = [];
	await page.route(`**${prefix}/search/stream**`, (route) => {
		requests.push(route.request().url());
		return route.fulfill({
			contentType: "text/event-stream",
			body: `event: started\ndata: {"query":"Streamed"}\n\nevent: batch\ndata: ${JSON.stringify({ kind: "collections", collections: [collection], classes: [], objects: [], next: "hidden" })}\n\nevent: error\ndata: {"message":"Database unavailable"}\n\n`,
		});
	});
	const initial = page.waitForResponse((response) =>
		response.url().includes("/api/v1/search?q="),
	);
	await page.goto("/search?q=Streamed&kinds=collection");
	await initial;
	await page.getByLabel("Stream results", { exact: true }).click();
	await expect(
		page.getByRole("alert").filter({ hasText: "Database unavailable" }),
	).toContainText("Database unavailable");
	await expect(
		page.getByRole("link", { name: /Streamed collection/ }),
	).toBeVisible();
	expect(requests).toHaveLength(1);
	await expect(page.getByRole("button", { name: /Load more/ })).toHaveCount(0);
});
test("searches all released catalogs and both streaming endpoints through the live BFF", async ({
	page,
}) => {
	test.setTimeout(60_000);
	for (const target of [
		"user",
		"group",
		"service_account",
		"audit_event",
	] as const) {
		await page.goto(queryUrl(target));
		await page.getByLabel("Stream results", { exact: true }).check();
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		const results = page.getByRole("region", {
			name: "Search results",
			exact: true,
		});
		await expect(
			results.getByRole("button", { name: "Cancel search", exact: true }),
		).toHaveCount(0);
		await expect(results).toContainText(
			/matching resources|resources on this page/,
		);
		await expect(results.getByRole("alert")).toHaveCount(0);
		if (target === "user")
			await expect(
				results.getByRole("link", { name: /admin \(#/ }),
			).toBeVisible();
		if (target === "audit_event") {
			await results
				.getByRole("button", { name: /Inspect event/ })
				.first()
				.click();
			await expect(page.getByRole("dialog")).toBeVisible();
			await page.keyboard.press("Escape");
		}
	}
	const streamed = page.waitForResponse(
		(response) =>
			response.url().includes("/api/v1/search/stream?") &&
			response.request().method() === "GET",
	);
	await page.goto("/search?q=admin&stream=true");
	const response = await streamed;
	expect(response.status()).toBe(200);
	await expect(
		page.getByText("Search complete.", { exact: true }),
	).toBeVisible();
	await expect(page.getByText(/This page is incomplete/)).toHaveCount(0);
	await expect(page.getByText("Searching across Hubuum...")).toHaveCount(0);
	await expect(
		page.getByRole("alert").filter({ hasText: "Failed to load unified" }),
	).toHaveCount(0);
});
