import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { Collection } from "@/lib/api/generated/models";

declare global {
	interface Window {
		quickSearchRequests?: { query: string; url: string; aborted: boolean }[];
		quickSearchLive?: boolean;
	}
}

const prefix = "/_hubuum-bff/hubuum/api/v1";
const collection = {
	id: 7,
	name: "Quasar operations",
	description: "",
	revision: 1,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
	parent_collection_id: null,
};
const resource = {
	id: 999,
	name: "Quasar servers",
	description: "",
	revision: 1,
	collection,
	created_at: collection.created_at,
	updated_at: collection.updated_at,
	validate_schema: false,
	json_schema: null,
};

// Real authenticated pages, with controllable browser streams for timing races.
async function installStreams(page: Page) {
	await page.addInitScript(
		({ prefix }) => {
			const original = window.fetch;
			const requests: { query: string; url: string; aborted: boolean }[] = [];
			Object.assign(window, { quickSearchRequests: requests });
			window.fetch = async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.href
							: input.url;
				if (window.quickSearchLive || !url.includes(`${prefix}/search/stream`))
					return original(input, init);
				const query = new URL(url, location.origin).searchParams.get("q") ?? "";
				const request = { query, url, aborted: false };
				requests.push(request);
				const encode = (event: string, data: unknown) =>
					new TextEncoder().encode(
						`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
					);
				let closed = false;
				let controller: ReadableStreamDefaultController<Uint8Array>;
				const receive = (event: Event) => {
					const detail = (
						event as CustomEvent<{
							query: string;
							event: string;
							data: unknown;
						}>
					).detail;
					if (closed || detail.query !== query) return;
					controller.enqueue(encode(detail.event, detail.data));
					if (detail.event === "done" || detail.event === "error") {
						closed = true;
						controller.close();
						window.removeEventListener("quick-search-stream", receive);
					}
				};
				const stream = new ReadableStream<Uint8Array>({
					start(value) {
						controller = value;
						controller.enqueue(encode("started", { query }));
						window.addEventListener("quick-search-stream", receive);
					},
					cancel() {
						closed = true;
						window.removeEventListener("quick-search-stream", receive);
					},
				});
				init?.signal?.addEventListener(
					"abort",
					() => {
						request.aborted = true;
						if (!closed) {
							closed = true;
							controller.error(new DOMException("Aborted", "AbortError"));
							window.removeEventListener("quick-search-stream", receive);
						}
					},
					{ once: true },
				);
				return new Response(stream, {
					headers: { "content-type": "text/event-stream" },
				});
			};
		},
		{ prefix },
	);
}
async function requests(page: Page) {
	return page.evaluate(() => window.quickSearchRequests ?? []);
}
async function started(page: Page, query = "Quasar", count = 1) {
	await expect
		.poll(
			async () =>
				(await requests(page)).filter((item) => item.query === query).length,
		)
		.toBe(count);
}
async function emit(
	page: Page,
	event: string,
	data: unknown,
	query = "Quasar",
) {
	await page.evaluate(
		(detail) =>
			window.dispatchEvent(new CustomEvent("quick-search-stream", { detail })),
		{ query, event, data },
	);
}
async function batch(
	page: Page,
	kind: "collections" | "classes" | "objects",
	items: unknown[],
	next: string | null = null,
	query = "Quasar",
) {
	await emit(page, "batch", { kind, [kind]: items, next }, query);
}
async function finish(
	page: Page,
	items = [resource],
	next: string | null = null,
	query = "Quasar",
) {
	await batch(page, "classes", items, next, query);
	await batch(page, "collections", [], null, query);
	await batch(page, "objects", [], null, query);
	await emit(page, "done", { query }, query);
}
async function palette(page: Page) {
	await page.keyboard.press("Control+k");
	const input = page.getByLabel("Find a destination or action");
	await expect(input).toBeFocused();
	return input;
}

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires a disposable authenticated backend.",
	);
	await installStreams(page);
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
	await page.route(`**${prefix}/classes?*`, (route) =>
		route.fulfill({ json: [resource] }),
	);
	await page.route(`**${prefix}/classes/999`, (route) =>
		route.fulfill({ json: resource }),
	);
	await page.route(`**${prefix}/collections?*`, (route) =>
		route.fulfill({ json: [collection] }),
	);
	await page.route(`**${prefix}/search?*`, (route) =>
		route.fulfill({
			json: {
				query: "Quasar",
				results: { collections: [], classes: [], objects: [] },
				next: {},
			},
		}),
	);
	await page.goto("/classes");
	await expect(
		page.getByRole("heading", { name: "Classes", exact: true }),
	).toBeVisible();
});

test("Enter waits for all catalogs, then opens the sole resource", async ({
	page,
}) => {
	const input = await palette(page);
	await input.fill("Quasar");
	await input.press("Enter");
	await started(page);
	await batch(page, "classes", [resource]);
	await expect(
		page.getByRole("link", { name: /Quasar servers Class #999/ }),
	).toBeVisible();
	await expect(
		page.getByRole("status").filter({ hasText: "Waiting for search" }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/classes$/);
	await batch(page, "collections", []);
	await batch(page, "objects", []);
	await emit(page, "done", { query: "Quasar" });
	await expect(page).toHaveURL(/\/classes\/999$/);
});

for (const width of [1440, 390]) {
	test(`/ search streams at ${width}px and opens a completed match only on Enter`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.keyboard.press("/");
		const input =
			width === 1440
				? page.getByLabel("Search collections, classes, and objects")
				: page
						.getByRole("dialog", { name: "Search workspace" })
						.getByRole("textbox");
		await expect(input).toBeFocused();
		await input.fill("Quasar");
		await started(page);
		await finish(page);
		await expect(
			page.getByRole("navigation", { name: "Search suggestions" }),
		).toContainText("1 resource match");
		await expect(page).toHaveURL(/\/classes$/);
		expect(
			(await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
				["serious", "critical"].includes(item.impact ?? ""),
			),
		).toEqual([]);
		expect(
			await page.evaluate(() => document.body.scrollWidth <= innerWidth),
		).toBe(true);
		await page.screenshot({
			path: testInfo.outputPath(`quick-search-${width}.png`),
		});
		await input.press("Enter");
		await expect(page).toHaveURL(/\/classes\/999$/);
	});
}

test("later batches preserve focus and explicit selections can open before completion", async ({
	page,
}) => {
	const input = await palette(page);
	await input.fill("Quasar");
	await started(page);
	await batch(page, "classes", [resource]);
	await input.press("ArrowDown");
	const selected = page.getByRole("link", {
		name: /Quasar servers Class #999/,
	});
	await expect(selected).toBeFocused();
	await batch(page, "collections", [collection]);
	await expect(
		page.getByRole("link", { name: /Quasar operations Collection #7/ }),
	).toBeVisible();
	await expect(selected).toBeFocused();
	await selected.press("Enter");
	await expect(page).toHaveURL(/\/classes\/999$/);
});

test("query changes cancel obsolete streams and pending navigation; Escape cancels the current stream", async ({
	page,
}) => {
	const input = await palette(page);
	await input.fill("Quasar");
	await started(page);
	await input.press("Enter");
	await input.fill("Pulsar");
	await expect.poll(async () => (await requests(page))[0]?.aborted).toBe(true);
	await started(page, "Pulsar");
	await finish(page, [resource]); // A late response from the obsolete stream.
	await batch(
		page,
		"classes",
		[{ ...resource, name: "Pulsar servers" }],
		null,
		"Pulsar",
	);
	await expect(
		page.getByRole("link", { name: /Pulsar servers Class #999/ }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: /Quasar servers Class #999/ }),
	).toHaveCount(0);
	await expect(page).toHaveURL(/\/classes$/);
	await input.press("Enter");
	await input.press("Escape");
	await expect(
		page.getByRole("dialog", { name: "Go to or create" }),
	).toBeHidden();
	await expect
		.poll(async () => (await requests(page)).at(-1)?.aborted)
		.toBe(true);
	await batch(page, "collections", [], null, "Pulsar");
	await batch(page, "objects", [], null, "Pulsar");
	await emit(page, "done", { query: "Pulsar" }, "Pulsar");
	await expect(page).toHaveURL(/\/classes$/);
});

for (const scenario of ["many", "more pages", "none"] as const) {
	test(`early Enter opens full search for ${scenario}`, async ({ page }) => {
		const input = await palette(page);
		await input.fill("Quasar");
		await input.press("Enter");
		await started(page);
		await finish(
			page,
			scenario === "none"
				? []
				: scenario === "many"
					? [resource, { ...resource, id: 1000 }]
					: [resource],
			scenario === "more pages" ? "next-page" : null,
		);
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/search" && url.searchParams.get("q") === "Quasar",
		);
	});
}

test("failed streams retain explicit choices and require an explicit retry", async ({
	page,
}) => {
	const input = await palette(page);
	await input.fill("Quasar");
	await started(page);
	await batch(page, "classes", [resource]);
	await input.press("Enter");
	await emit(page, "error", { message: "Interrupted" });
	await expect(
		page.getByRole("button", { name: "Retry search" }),
	).toBeVisible();
	await expect(
		page.getByRole("link", { name: /Quasar servers Class #999/ }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/classes$/);
	await page.getByRole("button", { name: "Retry search" }).click();
	await started(page, "Quasar", 2);
	await finish(page);
	await expect(
		page.getByRole("navigation", { name: "Search suggestions" }),
	).toContainText("1 resource match");
	await expect(page).toHaveURL(/\/classes$/);
	await page.getByRole("link", { name: /Quasar servers Class #999/ }).click();
	await expect(page).toHaveURL(/\/classes\/999$/);
});

test("pinned resources are not duplicated by streamed matches", async ({
	page,
}) => {
	await page.evaluate(() =>
		localStorage.setItem(
			"hubuum.pinned-items",
			JSON.stringify([
				{ type: "class", id: 999, name: "Quasar servers", timestamp: 1 },
			]),
		),
	);
	const input = await palette(page);
	await input.fill("Quasar");
	await started(page);
	await finish(page);
	await expect(
		page
			.getByRole("navigation", { name: "Search suggestions" })
			.getByRole("link", { name: /Quasar servers/ }),
	).toHaveCount(1);
});

test("desktop Escape dismisses suggestions without reopening them", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.keyboard.press("/");
	const input = page.getByLabel("Search collections, classes, and objects");
	await input.fill("Quasar");
	await started(page);
	await batch(page, "classes", [resource]);
	await input.press("ArrowDown");
	await page.keyboard.press("Escape");
	await expect(input).toBeFocused();
	await expect(
		page.getByRole("navigation", { name: "Search suggestions" }),
	).toBeHidden();
	await expect.poll(async () => (await requests(page))[0]?.aborted).toBe(true);
});

test("typing is debounced and composition does not search or navigate", async ({
	page,
}) => {
	await page.clock.install();
	const input = await palette(page);
	await input.fill("Qua");
	await page.clock.runFor(150);
	await input.fill("Quasar");
	await page.clock.runFor(150);
	expect(await requests(page)).toHaveLength(0);
	await page.clock.runFor(200);
	await started(page);
	await input.dispatchEvent("compositionstart");
	await input.fill("日本語");
	await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
	await page.clock.runFor(400);
	expect(await requests(page)).toHaveLength(1);
	await expect(page).toHaveURL(/\/classes$/);
	await input.dispatchEvent("compositionend");
	await page.clock.runFor(350);
	await started(page, "日本語");
});

test("workspace suggestions preserve catalog and data-search filters", async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/search?q=old&kinds=object&search_object_data=true");
	const input = page.getByLabel("Search collections, classes, and objects");
	await expect(input).toHaveValue("old");
	await page.keyboard.press("/");
	await input.fill("Quasar");
	await started(page);
	const url = new URL(
		(await requests(page)).at(-1)?.url ?? "",
		"http://localhost",
	);
	expect(url.searchParams.get("kinds")).toBe("object");
	expect(url.searchParams.get("search_object_data")).toBe("true");
	expect(url.searchParams.get("limit_per_kind")).toBe("5");
	await page
		.getByRole("link", { name: "Show all results for “Quasar”" })
		.click();
	await expect(page).toHaveURL(
		(next) =>
			next.searchParams.get("q") === "Quasar" &&
			next.searchParams.get("kinds") === "object" &&
			next.searchParams.get("search_object_data") === "true",
	);
});

test("a completed but paginated single match is not treated as unique", async ({
	page,
}) => {
	const input = await palette(page);
	await input.fill("Quasar");
	await started(page);
	await finish(page, [resource], "more");
	await expect(
		page.getByRole("navigation", { name: "Search suggestions" }),
	).toContainText("More matches available");
	await input.press("Enter");
	await expect(page).toHaveURL(
		(url) =>
			url.pathname === "/search" && url.searchParams.get("q") === "Quasar",
	);
});

test("Command+K suggestions remain accessible in dark mode", async ({
	page,
}, testInfo) => {
	await page.getByRole("button", { name: /Open account menu for/ }).click();
	await page.getByRole("button", { name: "Dark", exact: true }).click();
	await page.keyboard.press("Escape");
	await page.keyboard.press("Meta+k");
	const input = page.getByLabel("Find a destination or action");
	await input.fill("Quasar");
	await started(page);
	await finish(page);
	await expect(
		page.getByRole("navigation", { name: "Search suggestions" }),
	).toContainText("1 resource match");
	await input.press("ArrowDown");
	await expect(
		page.getByRole("link", { name: /Quasar servers Class #999/ }),
	).toBeFocused();
	expect(
		(await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
			["serious", "critical"].includes(item.impact ?? ""),
		),
	).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath("quick-search-dark.png") });
});

test("real server streaming opens an accessible resource through the BFF", async ({
	page,
}) => {
	const name = `QuickSearchLive${Date.now()}`;
	const headers = { Origin: new URL(page.url()).origin };
	const response = await page.request.post(`${prefix}/collections`, {
		headers,
		data: { name, description: "Disposable quick-search test", group_id: 1 },
	});
	expect(response.status()).toBe(201);
	const created: Collection = await response.json();
	try {
		await page.evaluate(() => {
			window.quickSearchLive = true;
		});
		const input = await palette(page);
		await input.fill(name);
		await expect(
			page.getByRole("navigation", { name: "Search suggestions" }),
		).toContainText("1 resource match");
		await input.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/collections/${created.id}$`));
	} finally {
		expect(
			(
				await page.request.delete(`${prefix}/collections/${created.id}`, {
					headers,
				})
			).status(),
		).toBe(204);
	}
});
