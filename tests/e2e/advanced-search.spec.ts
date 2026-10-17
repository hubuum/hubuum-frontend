import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { advancedSearchUrl, emptySearchDraft } from "@/lib/advanced-search";
import { frontendApiPath, hubuumBffPath } from "@/lib/api/frontend";
import type { StructuredSearchRequest } from "@/lib/api/generated/models";

// Authentication uses a disposable credential; keep it out of artifacts.
test.use({
	trace: "off",
	screenshot: "off",
	video: "off",
	reducedMotion: "reduce",
});
const timestamp = "2026-10-01T12:00:00";
const collection = (id: number, name: string) => ({
	id,
	name,
	description: "",
	parent_collection_id: null,
	revision: 1,
	created_at: timestamp,
	updated_at: timestamp,
});
const collections = [
	collection(42, "foo"),
	collection(73, "bar"),
	collection(74, "foo"),
];
const object = (id: number, name: string) => ({
	id,
	name,
	description: "Managed server",
	collection_id: 42,
	hubuum_class_id: 12,
	revision: 1,
	created_at: timestamp,
	updated_at: timestamp,
	data: {},
});
const serverClass = {
	id: 12,
	name: "Servers",
	description: "",
	collection: collections[0],
	validate_schema: false,
	json_schema: {},
	created_at: timestamp,
	updated_at: timestamp,
	revision: 1,
};
const siteClass = { ...serverClass, id: 13, name: "Sites" };

async function setTheme(page: Page, theme: string) {
	await page.getByRole("button", { name: /Open account menu for/ }).click();
	await page
		.getByRole("region", { name: "User menu" })
		.getByRole("button", {
			name: theme === "dark" ? "Dark" : "Light",
			exact: true,
		})
		.click();
	await page.keyboard.press("Escape");
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await page.evaluate(async () => {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
		);
		await Promise.all(
			document
				.getAnimations()
				.map((animation) => animation.finished.catch(() => undefined)),
		);
	});
}

async function fixtures(page: Page) {
	const requests: StructuredSearchRequest[] = [];
	await page.route(`**${hubuumBffPath("/api/v1/collections")}**`, (route) => {
		const match = new URL(route.request().url()).pathname.match(
			/collections\/(\d+)$/,
		);
		const item = match
			? collections.find((item) => item.id === Number(match[1]))
			: collections;
		return route.fulfill({
			status: item ? 200 : 404,
			json: item ?? { message: "Unavailable" },
		});
	});
	await page.route(`**${hubuumBffPath("/api/v1/classes")}**`, (route) =>
		route.fulfill({
			json: new URL(route.request().url()).pathname.endsWith("/12")
				? serverClass
				: new URL(route.request().url()).pathname.endsWith("/13")
					? siteClass
					: [serverClass, siteClass],
		}),
	);
	await page.route(`**${hubuumBffPath("/api/v1/search")}*`, async (route) => {
		if (route.request().method() === "GET")
			return route.fulfill({
				json: {
					query: new URL(route.request().url()).searchParams.get("q"),
					results: {
						collections,
						classes: [serverClass, siteClass],
						objects: [],
					},
					next: { collections: null, classes: null, objects: null },
				},
			});
		const body = route.request().postDataJSON() as StructuredSearchRequest;
		requests.push(body);
		const resource =
			body.target.kind === "object"
				? object(
						body.cursor ? 102 : 101,
						body.cursor ? "server-two" : "server-one",
					)
				: body.target.kind === "class"
					? serverClass
					: collections[0];
		await route.fulfill({
			json: {
				version: 1,
				kind: body.target.kind,
				results: [{ kind: body.target.kind, resource }],
				total: 2,
				next: body.cursor ? null : "page-two",
			},
		});
	});
	return requests;
}

test("advanced search requires a server-side session", async ({ page }) => {
	await page.goto("/search/advanced");
	await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test.describe("advanced search builder", () => {
	test.skip(
		!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
		"Requires the disposable authenticated test stack.",
	);
	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		const login = await page.request.post(frontendApiPath("/auth/login"), {
			headers: { Origin: new URL(page.url()).origin },
			data: {
				username: process.env.E2E_USERNAME,
				password: process.env.E2E_PASSWORD,
				identity_scope: "local",
			},
		});
		expect(login.status()).toBe(200);
	});

	test("groups collection alternatives, picks an exact class, executes, paginates and reopens", async ({
		page,
	}) => {
		const requests = await fixtures(page);
		await page.goto("/search");
		await expect(
			page.getByRole("link", { name: "Advanced search", exact: true }),
		).toHaveAttribute("href", "/search/advanced");
		await page.goto("/search/advanced");
		await page
			.getByRole("group", { name: "Condition 1.1", exact: true })
			.getByLabel("Value", { exact: true })
			.fill("server");
		await page.getByRole("button", { name: /^Exact object class/ }).click();
		await page
			.getByRole("combobox", { name: "Search classes" })
			.fill("Servers");
		await page.getByRole("option", { name: /Servers.*#12/ }).click();
		await page.getByRole("button", { name: "Add group", exact: true }).click();
		const group = page.getByRole("group", { name: "Group 1.2", exact: true });
		await group
			.getByRole("combobox", { name: "Match", exact: true })
			.selectOption("or");
		await group
			.getByRole("button", { name: "Add condition", exact: true })
			.click();
		for (const [position, name, id] of [
			[1, "foo", 42],
			[2, "bar", 73],
		] as const) {
			const row = page.getByRole("group", {
				name: `Condition 1.2.${position}`,
				exact: true,
			});
			await row
				.getByRole("combobox", { name: "Field", exact: true })
				.selectOption("collection_id");
			await row.getByRole("button", { name: /^Collection 1:/ }).click();
			await page
				.getByRole("combobox", { name: "Search collections" })
				.fill(name);
			await page
				.getByRole("option", { name: new RegExp(`${name}.*#${id}\\b`) })
				.click();
			await expect(
				row.getByRole("button", { name: new RegExp(`${name}.*#${id}`) }),
			).toBeVisible();
		}
		await expect(
			page.getByRole("button", { name: "Run search", exact: true }),
		).toBeEnabled();
		expect(requests).toHaveLength(0);
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(
			page.getByRole("link", { name: "server-one (#101)" }),
		).toBeVisible();
		expect(requests[0].target).toEqual({ kind: "object", class: { id: 12 } });
		expect(requests[0].filter).toEqual({
			op: "and",
			args: [
				{
					op: "field",
					predicate: { field: "name", operator: "icontains", value: "server" },
				},
				{
					op: "or",
					args: [42, 73].map((value) => ({
						op: "field",
						predicate: { field: "collection_id", operator: "equals", value },
					})),
				},
			],
		});
		const bookmark = page.url();
		await page.getByRole("button", { name: "Next page" }).click();
		await expect(
			page.getByRole("link", { name: "server-two (#102)" }),
		).toBeVisible();
		expect(requests[1].cursor).toBe("page-two");
		await page
			.getByRole("group", { name: "Condition 1.1", exact: true })
			.getByLabel("Value", { exact: true })
			.fill("router");
		await expect(page.getByText(/The builder has changed/)).toBeVisible();
		expect(requests).toHaveLength(2);
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(
			page.getByRole("link", { name: "server-one (#101)" }),
		).toBeVisible();
		expect(requests[2].cursor).toBeUndefined();
		await page.goto(bookmark);
		await expect(
			page
				.getByRole("group", { name: "Condition 1.1", exact: true })
				.getByLabel("Value", { exact: true }),
		).toHaveValue("server");
		await expect(
			page.getByRole("button", { name: /Exact object class.*Servers.*#12/ }),
		).toBeVisible();
		await expect(
			page.getByRole("region", { name: "Search results" }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(
			page.getByRole("link", { name: "server-one (#101)" }),
		).toBeVisible();
		expect(requests[3]).toEqual(requests[0]);
	});

	for (const target of ["class", "object"] as const)
		test(`keeps both JSON range bounds when changing value type for ${target} searches`, async ({
			page,
		}) => {
			const requests = await fixtures(page);
			await page.goto("/search/advanced");
			await page
				.getByRole("combobox", { name: "Search", exact: true })
				.selectOption(target);
			await page
				.getByRole("combobox", { name: "Field", exact: true })
				.selectOption(target === "class" ? "json_schema" : "json_data");
			await page.getByLabel("JSON path").fill("range");
			await page
				.getByRole("combobox", { name: "Operator", exact: true })
				.selectOption("between");
			await page.getByLabel("Lower bound").fill("a");
			await page.getByLabel("Upper bound").fill("z");
			for (const [valueType, lower, upper, expected] of [
				["number", "1", "10", [1, 10]],
				[
					"date",
					"2026-01-01T12:00",
					"2026-01-02T12:00",
					["2026-01-01T12:00:00Z", "2026-01-02T12:00:00Z"],
				],
			] as const) {
				await page
					.getByRole("combobox", { name: "Value type", exact: true })
					.selectOption(valueType);
				await expect(page.getByLabel("Lower bound")).toHaveValue("");
				await expect(page.getByLabel("Upper bound")).toHaveValue("");
				await page.getByLabel("Lower bound").fill(lower);
				await page.getByLabel("Upper bound").fill(upper);
				const count = requests.length;
				await page
					.getByRole("button", { name: "Run search", exact: true })
					.click();
				await expect.poll(() => requests.length).toBe(count + 1);
				expect(requests[count].filter).toEqual({
					op: "field",
					predicate: {
						field: target === "class" ? "json_schema" : "json_data",
						operator: "between",
						path: "range",
						value: expected,
					},
				});
			}
		});

	test("runs oversized queries without a bookmark and safely refreshes", async ({
		page,
	}) => {
		const requests = await fixtures(page);
		await page.goto("/search/advanced");
		const value = page.getByLabel("Value", { exact: true });
		const run = page.getByRole("button", { name: "Run search", exact: true });
		const bookmark = page.getByRole("link", { name: "Bookmark this query" });
		const notice = page
			.getByRole("status")
			.filter({ hasText: "too large to bookmark" });
		await value.fill("server");
		await run.click();
		await expect.poll(() => requests.length).toBe(1);
		await expect(page).toHaveURL(/\?query=/);

		const largeValue = "x".repeat(17_000);
		await value.fill(largeValue);
		await expect(bookmark).toHaveCount(0);
		await expect(notice).toContainText("refreshing will clear it");
		await expect(run).toBeEnabled();
		await run.click();
		await expect.poll(() => requests.length).toBe(2);
		expect(requests[1].filter).toEqual({
			op: "field",
			predicate: { field: "name", operator: "icontains", value: largeValue },
		});
		await expect(page).toHaveURL(/\/search\/advanced$/);
		await expect(value).toHaveValue(largeValue);
		await expect(notice).toBeVisible();
		const response = await page.reload();
		expect(response?.status()).toBe(200);
		await expect(value).toHaveValue("");
		await expect(
			page.getByRole("region", { name: "Search results" }),
		).toHaveCount(0);
		expect(requests).toHaveLength(2);

		await value.fill(largeValue);
		await expect(notice).toBeVisible();
		await value.fill("router");
		await expect(bookmark).toBeVisible();
		await expect(notice).toHaveCount(0);
		await run.click();
		await expect.poll(() => requests.length).toBe(3);
		await expect(page).toHaveURL(/\?query=/);
		await page.reload();
		await expect(value).toHaveValue("router");
		expect(requests).toHaveLength(3);
	});

	for (const target of ["collection", "class", "object"] as const)
		test(`executes ${target} searches and validates incompatible changes`, async ({
			page,
		}) => {
			const requests = await fixtures(page);
			await page.goto("/search/advanced");
			await page
				.getByRole("combobox", { name: "Search", exact: true })
				.selectOption(target);
			await page.getByLabel("Value", { exact: true }).fill("server");
			await page
				.getByRole("button", { name: "Run search", exact: true })
				.click();
			await expect(page.getByText("2 matching resources")).toBeVisible();
			expect(requests[0].target.kind).toBe(target);
			if (target !== "collection") {
				await page
					.getByRole("combobox", { name: "Field", exact: true })
					.selectOption("collection_id");
				await page
					.getByRole("combobox", { name: "Search", exact: true })
					.selectOption("collection");
				await expect(
					page.getByText(/Field “collection_id” is incompatible/),
				).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Run search", exact: true }),
				).toBeDisabled();
			}
		});

	test("supports keyboard controls, accessible labels and mobile light/dark layouts", async ({
		page,
	}) => {
		await fixtures(page);
		await page.goto("/search/advanced");
		await page.getByLabel("Value", { exact: true }).fill("server");
		await page
			.getByRole("button", { name: "Add related-object condition" })
			.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("group", { name: "Related objects 1.2", exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: /^Related object class:/ }).focus();
		await page.keyboard.press("Enter");
		await page
			.getByRole("combobox", { name: "Search classes" })
			.fill("Servers");
		await expect(
			page.getByRole("option", { name: /Servers.*#12/ }),
		).toBeVisible();
		await page.keyboard.press("ArrowDown");
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("button", { name: /Related object class: Servers.*#12/ }),
		).toBeVisible();
		await page.getByRole("button", { name: "Remove related filter 1" }).focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("button", { name: "Add related filter" }),
		).toBeFocused();
		for (const theme of ["light", "dark"]) {
			await setTheme(page, theme);
			await page.setViewportSize({ width: 390, height: 844 });
			const results = await new AxeBuilder({ page })
				.include(".advanced-search")
				.analyze();
			expect(results.violations).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
		}
		await page
			.getByRole("button", { name: "Remove condition 1.2", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("button", { name: "Add condition", exact: true }),
		).toBeFocused();
	});

	test("rejects unsupported restored state without executing a broader query", async ({
		page,
	}) => {
		const requests = await fixtures(page);
		await page.goto(
			`/search/advanced?query=${encodeURIComponent(JSON.stringify({ version: 99 }))}`,
		);
		await expect(
			page.locator(".advanced-search").getByRole("alert"),
		).toContainText("Cannot restore this query");
		await expect(
			page.getByRole("button", { name: "Run search", exact: true }),
		).toHaveCount(0);
		expect(requests).toHaveLength(0);
	});

	test("restored selections use current names and preserve unavailable IDs", async ({
		page,
	}) => {
		const requests = await fixtures(page);
		const draft = emptySearchDraft();
		draft.filter = {
			id: "collection",
			kind: "field",
			negate: false,
			condition: {
				field: "collection_id",
				operator: "in",
				path: "",
				valueType: "text",
				values: ["42", "99"],
			},
		};
		await page.route(`**${hubuumBffPath("/api/v1/collections/42")}`, (route) =>
			route.fulfill({ json: collection(42, "Renamed collection") }),
		);
		await page.goto(advancedSearchUrl(draft));
		await expect(
			page.getByRole("button", {
				name: /Collection 1: Renamed collection.*#42/,
			}),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Collection 2: #99.*name unavailable/ }),
		).toBeVisible();
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(page.getByText("2 matching resources")).toBeVisible();
		expect(requests[0].filter).toEqual({
			op: "field",
			predicate: { field: "collection_id", operator: "in", value: [42, 99] },
		});
	});

	test("ignores stale responses and never broadens a failed search", async ({
		page,
	}) => {
		await fixtures(page);
		let releaseOld: (() => void) | undefined;
		const pending = new Promise<void>((resolve) => {
			releaseOld = resolve;
		});
		let requestCount = 0;
		await page.route(`**${hubuumBffPath("/api/v1/search")}`, async (route) => {
			requestCount++;
			const number = requestCount;
			if (number === 1) await pending;
			if (number === 3)
				return route.fulfill({
					status: 400,
					json: { message: "Unsupported expression" },
				});
			await route.fulfill({
				json: {
					version: 1,
					kind: "object",
					results: [
						{
							kind: "object",
							resource: object(
								number,
								number === 1 ? "old-result" : "new-result",
							),
						},
					],
					total: 1,
					next: null,
				},
			});
		});
		await page.goto("/search/advanced");
		await page.getByLabel("Value", { exact: true }).fill("old");
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect.poll(() => requestCount).toBe(1);
		await page.getByLabel("Value", { exact: true }).fill("new");
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(
			page.getByRole("link", { name: "new-result (#2)" }),
		).toBeVisible();
		releaseOld?.();
		await expect(
			page.getByRole("link", { name: "old-result (#1)" }),
		).toHaveCount(0);
		await page.getByLabel("Value", { exact: true }).fill("invalid");
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(
			page.locator(".advanced-search").getByRole("alert"),
		).toContainText("Unsupported expression");
		expect(requestCount).toBe(3);
		await expect(
			page.getByRole("link", { name: "new-result (#2)" }),
		).toHaveCount(0);
	});

	test("inspects related resources lazily, caches within the page and reports truncation or unavailable support", async ({
		page,
	}) => {
		const searches = await fixtures(page);
		const hydration: unknown[] = [];
		let completedHydrations = 0;
		page.on("requestfinished", (request) => {
			if (
				new URL(request.url()).pathname ===
				hubuumBffPath("/api/v1/search/hydrate")
			)
				completedHydrations += 1;
		});
		await page.route(
			`**${hubuumBffPath("/api/v1/search/hydrate")}`,
			async (route) => {
				const body = route.request().postDataJSON();
				hydration.push(body);
				if (body.root_object_id === 102)
					return route.fulfill({
						status: 404,
						json: { message: "Unknown endpoint" },
					});
				return route.fulfill({
					json: {
						version: 1,
						root_object_id: 101,
						target_class_id: 13,
						depth: 2,
						limit: 25,
						truncated: true,
						objects: [
							object(101, "server-one"),
							{ ...object(202, "Oslo"), hubuum_class_id: 13 },
						],
						relations: [
							{
								id: 301,
								from_hubuum_object_id: 101,
								to_hubuum_object_id: 202,
								class_relation_id: 401,
								created_at: timestamp,
								updated_at: timestamp,
								revision: 1,
							},
						],
						paths: [{ object_ids: [101, 202], relation_ids: [301] }],
					},
				});
			},
		);
		await page.goto("/search/advanced");
		await page.getByLabel("Value", { exact: true }).fill("server");
		await page
			.getByRole("button", { name: "Add related-object condition" })
			.click();
		const related = page.getByRole("group", {
			name: "Related objects 1.2",
			exact: true,
		});
		await related
			.getByRole("button", { name: /^Related object class:/ })
			.click();
		await page.getByRole("option", { name: /Sites.*#13/ }).click();
		await related
			.getByRole("spinbutton", { name: "Traversal depth (1–10)" })
			.fill("2");
		await related
			.getByRole("combobox", { name: "Operator", exact: true })
			.selectOption("equals");
		await related.getByLabel("Value", { exact: true }).fill("Oslo");
		await page
			.getByRole("checkbox", {
				name: "Enable optional related-resource inspection",
			})
			.check();
		await page
			.getByRole("button", { name: /^Related-resource class:/ })
			.click();
		await page.getByRole("option", { name: /Sites.*#13/ }).click();
		await page
			.getByRole("spinbutton", { name: "Inspection depth (1–10)" })
			.fill("2");
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await expect(page.getByText("2 matching resources")).toBeVisible();
		expect(hydration).toHaveLength(0);
		expect(searches[0].filter).toMatchObject({
			op: "and",
			args: [
				{ op: "field" },
				{
					op: "related",
					predicate: {
						class: { id: 13 },
						depth: 2,
						filters: [{ field: "name", operator: "equals", value: "Oslo" }],
					},
				},
			],
		});
		await page
			.getByRole("button", { name: "Inspect related resources", exact: true })
			.click();
		const panel = page.getByRole("region", {
			name: "Related resources for server-one (#101)",
		});
		await expect(panel.getByText(/Partial neighborhood/)).toBeVisible();
		await expect(
			panel.getByRole("link", { name: "Oslo (#202)" }).first(),
		).toHaveAttribute("href", "/objects/13/202");
		await expect(panel.getByText("Connecting relations: #301")).toBeVisible();
		// Development Strict Mode may cancel and restart the initial mount.
		await expect.poll(() => completedHydrations).toBe(1);
		for (const request of hydration)
			expect(request).toEqual({
				version: 1,
				root_class_id: 12,
				root_object_id: 101,
				class: { id: 13 },
				depth: 2,
				limit: 25,
			});
		const initialRequests = hydration.length;
		await page.getByRole("button", { name: "Close related resources" }).click();
		await expect(panel).toBeHidden();
		await page
			.getByRole("button", { name: "Inspect related resources", exact: true })
			.click();
		await expect(panel.getByText(/Partial neighborhood/)).toBeVisible();
		expect(hydration).toHaveLength(initialRequests);
		for (const theme of ["light", "dark"]) {
			await setTheme(page, theme);
			await page.setViewportSize({ width: 390, height: 844 });
			expect(
				(await new AxeBuilder({ page }).include(".advanced-search").analyze())
					.violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
		}
		await page.getByRole("button", { name: "Next page" }).click();
		await expect(
			page.getByRole("link", { name: "server-two (#102)" }),
		).toBeVisible();
		await expect(panel).toHaveCount(0);
		expect(searches[1]).toEqual({ ...searches[0], cursor: "page-two" });
		await page
			.getByRole("button", { name: "Inspect related resources", exact: true })
			.click();
		await expect(
			page
				.getByRole("region", {
					name: "Related resources for server-two (#102)",
				})
				.getByRole("alert"),
		).toContainText("unavailable on this server");
		await expect(page.getByText("2 matching resources")).toBeVisible();
	});

	test("leaves delayed hydration behind when the root page changes", async ({
		page,
	}) => {
		await fixtures(page);
		let release: (() => void) | undefined;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let requested = false;
		await page.route(
			`**${hubuumBffPath("/api/v1/search/hydrate")}`,
			async (route) => {
				requested = true;
				await blocked;
				await route.fulfill({
					status: 400,
					json: { message: "Old inspection failed" },
				});
			},
		);
		const draft = emptySearchDraft();
		draft.filter = {
			id: "name",
			kind: "field",
			negate: false,
			condition: {
				field: "name",
				operator: "contains",
				path: "",
				valueType: "text",
				values: ["server"],
			},
		};
		draft.hydration = { classId: "13", depth: 1, limit: 5 };
		await page.goto(advancedSearchUrl(draft));
		await page.getByRole("button", { name: "Run search", exact: true }).click();
		await page
			.getByRole("button", { name: "Inspect related resources", exact: true })
			.click();
		await expect.poll(() => requested).toBe(true);
		await expect(
			page.getByText("Loading visible related resources…"),
		).toBeVisible();
		await page.getByRole("button", { name: "Next page" }).click();
		await expect(
			page.getByRole("link", { name: "server-two (#102)" }),
		).toBeVisible();
		release?.();
		await expect(
			page.getByRole("region", {
				name: "Related resources for server-one (#101)",
			}),
		).toHaveCount(0);
		await expect(page.getByText("Old inspection failed")).toHaveCount(0);
		await expect(page.getByText("2 matching resources")).toBeVisible();
	});
});
