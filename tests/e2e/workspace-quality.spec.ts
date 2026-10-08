import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const timestamp = "2026-01-01T12:00:00Z";
const root = {
	id: 1,
	name: "Infrastructure",
	description: "Managed infrastructure",
	parent_collection_id: null,
	created_at: timestamp,
	updated_at: timestamp,
	revision: 1,
};
const classes = [
	{ id: 10, name: "Devices", description: "Managed devices" },
	{ id: 20, name: "Services", description: "Applications and services" },
].map((item) => ({
	...item,
	collection: root,
	created_at: timestamp,
	updated_at: timestamp,
	revision: 1,
	validate_schema: false,
	json_schema: null,
}));
const remoteClass = { ...classes[0], id: 999, name: "Remote devices" };
const prefix = "/_hubuum-bff/hubuum/api/v1";

async function prepareWorkspace(page: Page) {
	await page.route(`**${prefix}/classes?*`, (route) => {
		const url = new URL(route.request().url());
		const selectedIds = url.searchParams.get("id__in")?.split(",").map(Number);
		if (selectedIds) {
			return route.fulfill({
				json: [...classes, remoteClass].filter((item) =>
					selectedIds.includes(item.id),
				),
			});
		}
		return route.fulfill({
			json: url.searchParams.has("cursor") ? [remoteClass] : classes,
			headers: url.searchParams.has("cursor")
				? { "X-Total-Count": "3" }
				: { "X-Next-Cursor": "next", "X-Total-Count": "3" },
		});
	});
	await page.route(`**${prefix}/classes/999?*`, (route) =>
		route.fulfill({ json: remoteClass }),
	);
	await page.route(`**${prefix}/collections?*`, (route) =>
		route.fulfill({ json: [root] }),
	);
	await page.route(`**${prefix}/collections/1`, (route) =>
		route.fulfill({ json: root }),
	);
	await page.route(`**${prefix}/search?*`, (route) =>
		route.fulfill({
			json: {
				query: "Remote",
				results: { classes: [remoteClass], collections: [], objects: [] },
				next: {},
			},
		}),
	);
	await page.route("**/_hubuum-bff/classes/*/objects?*", (route) =>
		route.fulfill({ json: [] }),
	);
	await page.route("**/_hubuum-bff/classes/*/computed-fields*", (route) =>
		route.fulfill({ json: [] }),
	);
	await page.goto("/classes");
	await expect(
		page.getByRole("heading", { name: "Classes", exact: true }),
	).toBeVisible();
	await expect(
		page.locator("#classes-table").getByText("Devices", { exact: true }),
	).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
}

test.describe("workspace quality", () => {
	test.skip(
		!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
		"Requires the disposable authenticated test stack.",
	);
	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		await expect(
			page.getByRole("form", { name: "Login form" }),
		).not.toHaveAttribute("data-provider-discovery", "loading");
		const scope = page.locator("#identity-scope");
		if (await page.locator("select#identity-scope").isVisible())
			await scope.selectOption(process.env.E2E_IDENTITY_SCOPE ?? "local");
		else if ((await scope.getAttribute("type")) !== "hidden")
			await scope.fill(process.env.E2E_IDENTITY_SCOPE ?? "local");
		await page.getByLabel("Username").fill(process.env.E2E_USERNAME ?? "");
		await page
			.getByLabel("Password", { exact: true })
			.fill(process.env.E2E_PASSWORD ?? "");
		await page.getByRole("button", { name: "Enter workspace" }).click();
		await page.waitForURL("**/app");
		await prepareWorkspace(page);
	});

	test("object aggregation supports three ordered dimensions, measures and exports", async ({
		page,
	}, testInfo) => {
		test.setTimeout(90_000);
		page.setDefaultTimeout(10_000);
		const requests: URLSearchParams[] = [];
		await page.route(`**${prefix}/classes/10?*`, (route) =>
			route.fulfill({ json: classes[0] }),
		);
		await page.route("**/_hubuum-bff/classes/10/objects?*", (route) =>
			route.fulfill({
				json: [
					{
						id: 100,
						name: "rhel-host",
						description: "RHEL",
						collection_id: 1,
						hubuum_class_id: 10,
						created_at: timestamp,
						updated_at: timestamp,
						data: { os_major: 9, os_minor: 1, cost: 10 },
						computed: { shared: { values: {}, errors: {} } },
					},
				],
			}),
		);
		await page.route(`**${prefix}/classes/10/computed-fields*`, (route) =>
			route.fulfill({ json: { fields: [] } }),
		);
		await page.route(`**${prefix}/iam/me/computed-fields*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.route(`**${prefix}/classes/10/object-aggregates?*`, (route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			const dimensions = params.getAll("group_by");
			const minors = dimensions.includes("json_data.os_minor")
				? params.has("cursor")
					? [null, undefined]
					: [1, 2]
				: [1];
			return route.fulfill({
				json: minors.map((minor, index) => ({
					dimensions: dimensions.map((field) => ({
						field,
						state:
							field === "json_data.os_minor" && minor == null
								? minor === null
									? "null"
									: "missing"
								: "value",
						value:
							field === "json_data.os_major"
								? 9
								: field === "json_data.os_minor"
									? minor
									: field === "collection_id"
										? 1
										: "rhel-host",
					})),
					object_count: index === 0 ? 40 : 35,
					measures: params.getAll("aggregate").map((measure) => ({
						operation: measure.split(":")[0],
						field: measure.split(":")[1],
						state: "value",
						value: 400,
						value_count: 40,
						skipped_count: 0,
					})),
				})),
				headers: params.has("cursor")
					? { "X-Total-Count": "4" }
					: { "X-Next-Cursor": "aggregate-next", "X-Total-Count": "4" },
			});
		});
		await page.goto("/objects?classId=10");
		await expect(
			page.getByRole("link", { name: "rhel-host", exact: true }),
		).toBeVisible();
		const trigger = page.getByRole("button", { name: /^Aggregate/ });
		await trigger.click();
		const menu = page.getByRole("dialog", { name: "Group objects" });
		await menu
			.getByRole("combobox", { name: "Group by", exact: true })
			.selectOption({ label: "os_major" });
		await menu.getByRole("button", { name: "Add group by" }).click();
		await menu
			.getByRole("combobox", { name: "Group by 2", exact: true })
			.selectOption({ label: "os_minor" });
		await expect
			.poll(() => requests.at(-1)?.getAll("group_by"))
			.toEqual(["json_data.os_major", "json_data.os_minor"]);
		const table = page.getByRole("region", {
			name: "Object aggregates",
			exact: true,
		});
		await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
			"9",
			"1",
			"40",
		]);
		await expect(table.getByRole("row").nth(2).getByRole("cell")).toHaveText([
			"9",
			"2",
			"35",
		]);
		await menu.getByRole("button", { name: "Add group by" }).click();
		await expect(
			menu.getByRole("combobox", { name: "Group by 3", exact: true }),
		).toHaveValue("object:collection");
		await expect(
			menu.getByRole("button", { name: "Add group by" }),
		).toBeDisabled();
		await expect(
			menu
				.getByRole("combobox", { name: "Group by 3", exact: true })
				.getByRole("option", { name: "os_major", exact: true }),
		).toHaveJSProperty("disabled", true);
		await menu.getByRole("button", { name: "Add measure" }).click();
		await menu.getByLabel("Numeric field").selectOption({ label: "cost" });
		await expect
			.poll(() => requests.at(-1)?.getAll("aggregate"))
			.toEqual(["sum:json_data.cost"]);
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
		await expect(
			table.getByRole("row").nth(1).getByRole("cell").nth(2),
		).toHaveText("Infrastructure (#1)");
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect
			.poll(() => requests.at(-1)?.get("cursor"))
			.toBe("aggregate-next");
		await expect(
			table.getByRole("row").nth(1).getByRole("cell").nth(1),
		).toHaveText("(null)");
		await expect(
			table.getByRole("row").nth(2).getByRole("cell").nth(1),
		).toHaveText("(missing)");
		await trigger.click();
		await menu
			.getByRole("button", { name: "Move grouping field 3 up" })
			.click();
		await expect
			.poll(() => requests.at(-1)?.getAll("group_by"))
			.toEqual(["json_data.os_major", "collection_id", "json_data.os_minor"]);
		expect(requests.at(-1)?.has("cursor")).toBe(false);
		await menu.getByLabel("Sort groups").selectOption("value-asc");
		await expect
			.poll(() => requests.at(-1)?.get("sort"))
			.toBe("dimensions.asc");
		await page.keyboard.press("Escape");
		await expect(table.getByRole("columnheader")).toHaveText([
			/os_major/,
			"Collection",
			"os_minor",
			/Count/,
			"Sum · cost",
		]);
		await page.getByRole("button", { name: "Download", exact: true }).click();
		const downloaded = page.waitForEvent("download");
		await page.getByRole("menuitem", { name: /CSV/ }).click();
		const stream = await (await downloaded).createReadStream();
		const chunks = [];
		for await (const chunk of stream) chunks.push(chunk);
		const csv = Buffer.concat(chunks).toString("utf8");
		expect(csv).toContain("os_major,Collection,os_minor,Count,Sum · cost");
		expect(csv).toContain("9,Infrastructure (#1),1,40,400");
		await trigger.click();
		for (const width of [1440, 1280, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(
				menu.getByRole("combobox", { name: "Group by 3", exact: true }),
			).toBeVisible();
			await expect
				.poll(() =>
					menu.evaluate((element) => {
						const bounds = element.getBoundingClientRect();
						return (
							element.scrollWidth <= element.clientWidth &&
							bounds.left >= 0 &&
							bounds.right <= window.innerWidth &&
						bounds.bottom <= window.innerHeight
						);
					}),
				)
				.toBe(true);
			expect(
				(
					await new AxeBuilder({ page })
						.include('[role="dialog"]')
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze()
				).violations,
			).toEqual([]);
			await page.screenshot({
				path: testInfo.outputPath(`aggregation-${width}.png`),
			});
		}
		await menu.getByRole("button", { name: "Remove grouping field 2" }).click();
		await expect(
			menu.getByRole("combobox", { name: "Group by", exact: true }),
		).toBeFocused();
		await expect(
			menu.getByRole("combobox", { name: "Group by 2", exact: true }),
		).toHaveValue('data:["os_minor"]');
		await expect(
			menu.getByRole("button", { name: "Add group by" }),
		).toBeEnabled();
		await menu.getByRole("button", { name: "Remove grouping field 2" }).click();
		await menu.getByRole("button", { name: "Remove grouping field 1" }).click();
		await expect.poll(() => requests.at(-1)?.getAll("group_by")).toEqual([]);
		expect(requests.at(-1)?.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
		]);
		await expect(
			table.getByRole("cell", { name: "All matching objects" }),
		).toBeVisible();
		await menu.getByRole("button", { name: "Clear", exact: true }).click();
		await expect(table).toBeHidden();
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: /^Columns/ }).click();
		const columns = page.getByRole("dialog", { name: "Object columns" });
		await columns.getByText("Create a custom field", { exact: true }).click();
		await columns.getByLabel("Label", { exact: true }).fill("OS fallback");
		await columns
			.getByLabel("Paths", { exact: true })
			.fill("os_major|os_minor");
		await columns.getByRole("button", { name: "Add custom field" }).click();
		await page.keyboard.press("Escape");
		await trigger.click();
		await menu
			.getByRole("combobox", { name: "Group by", exact: true })
			.selectOption({ label: "OS fallback" });
		await expect(
			menu.getByRole("button", { name: "Add group by" }),
		).toBeDisabled();
		await expect(
			menu.getByRole("button", { name: "Add measure" }),
		).toBeDisabled();
		const localTable = page.getByRole("region", {
			name: "Grouped objects",
			exact: true,
		});
		await expect(
			localTable.getByRole("row").nth(1).getByRole("cell"),
		).toHaveText(["9", "1", "rhel-host"]);
	});

	for (const theme of ["light", "dark"] as const) {
		test(`search shortcut hints follow focus and input in ${theme} mode`, async ({
			page,
		}, testInfo) => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.getByRole("button", { name: /Open account menu for/ }).click();
			await page
				.getByRole("button", {
					name: theme === "dark" ? "Dark" : "Light",
					exact: true,
				})
				.click();
			await page.keyboard.press("Escape");
			const commands = page.getByRole("button", {
				name: "Go to or create",
				exact: true,
			});
			const search = page.getByRole("textbox", {
				name: "Search collections, classes, and objects",
			});
			const hint = page.getByText("Type / to search", { exact: true });
			await commands.focus();
			await expect(hint).toBeVisible();
			await expect(commands.getByText("Ctrl/⌘ K", { exact: true })).toBeVisible();
			await expect(commands).toHaveAttribute(
				"aria-keyshortcuts",
				"Control+k Meta+k",
			);
			await expect(search).toHaveAttribute("aria-keyshortcuts", "/");
			const violations = (
				await new AxeBuilder({ page }).analyze()
			).violations.filter((item) =>
				["serious", "critical"].includes(item.impact ?? ""),
			);
			expect(violations).toEqual([]);
			await page.screenshot({ path: testInfo.outputPath("shortcut-hints.png") });
			await page.keyboard.press("/");
			await expect(search).toBeFocused();
			await expect(search).toHaveValue("");
			await expect(hint).toBeHidden();
			await search.fill("router");
			await page.keyboard.press("/");
			await expect(search).toHaveValue("router/");
			await commands.focus();
			await expect(hint).toBeHidden();
			await search.fill("");
			await commands.focus();
			await expect(hint).toBeVisible();
			await page.keyboard.press("Control+k");
			await expect(page.getByLabel("Find a destination or action")).toBeFocused();
			await page.keyboard.press("Escape");
			for (const width of [1024, 390]) {
				await page.setViewportSize({ width, height: 844 });
				await expect(search).toBeHidden();
				await commands.focus();
				await page.keyboard.press("/");
				const dialog = page.getByRole("dialog", { name: "Search workspace" });
				await expect(dialog).toBeVisible();
				await expect(dialog.getByRole("textbox")).toBeFocused();
				await page.keyboard.press("Escape");
				expect(
					await page.evaluate(() => document.body.scrollWidth <= innerWidth),
				).toBe(true);
			}
			await expect(commands.getByText("Ctrl/⌘ K", { exact: true })).toBeHidden();
		});
	}

	test("table shortcuts respect other controls and move actual row focus", async ({
		page,
	}) => {
		const filter = page.getByRole("textbox", {
			name: "Find classes on this loaded page",
		});
		await filter.focus();
		await page.keyboard.press("ArrowDown");
		await expect(filter).toBeFocused();
		const table = page.locator("#classes-table");
		await table.focus();
		await page.keyboard.press("ArrowDown");
		await expect(table.locator('[data-table-row-index="0"]')).toBeFocused();
		await page.keyboard.press("ArrowDown");
		await expect(table.locator('[data-table-row-index="1"]')).toBeFocused();
		await page
			.getByRole("button", { name: "Go to or create", exact: true })
			.focus();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("dialog", { name: "Go to or create" }),
		).toBeVisible();
		await expect(page.getByLabel("Find a destination or action")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: "Go to or create", exact: true }),
		).toBeFocused();
		await page.keyboard.press("Control+k");
		await expect(
			page.getByRole("dialog", { name: "Go to or create" }),
		).toBeVisible();
		await page.getByLabel("Find a destination or action").fill("New class");
		await page.keyboard.press("ArrowDown");
		await expect(
			page
				.getByRole("dialog", { name: "Go to or create" })
				.getByRole("button", { name: "New class", exact: true }),
		).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(
			page.getByRole("dialog", { name: "Create class" }),
		).toBeVisible();
	});

	test("Go to Enter runs a resource search directly from the input", async ({
		page,
	}) => {
		await page
			.getByRole("button", { name: "Go to or create", exact: true })
			.click();
		const input = page.getByLabel("Find a destination or action");
		const query = "router & switch / 日本語";
		await input.fill(`  ${query}  `);
		await input.press("Enter");
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/search" && url.searchParams.get("q") === query,
		);
		await expect(
			page.getByRole("dialog", { name: "Go to or create" }),
		).toBeHidden();
	});

	test("Go to Enter opens the first matching destination", async ({ page }) => {
		await page
			.getByRole("button", { name: "Go to or create", exact: true })
			.click();
		const input = page.getByLabel("Find a destination or action");
		await input.fill("About");
		await input.press("Enter");
		await expect(page).toHaveURL(/\/about$/);
		await expect(
			page.getByRole("dialog", { name: "Go to or create" }),
		).toBeHidden();
	});

	test("Go to Enter opens a matching create action", async ({ page }) => {
		await page
			.getByRole("button", { name: "Go to or create", exact: true })
			.click();
		const input = page.getByLabel("Find a destination or action");
		await input.fill("New class");
		await input.press("Enter");
		await expect(
			page.getByRole("dialog", { name: "Create class" }),
		).toBeVisible();
	});

	test("Go to ignores blank or composing Enter and preserves explicit selection", async ({
		page,
	}) => {
		await page
			.getByRole("button", { name: "Go to or create", exact: true })
			.click();
		const dialog = page.getByRole("dialog", { name: "Go to or create" });
		const input = page.getByLabel("Find a destination or action");
		await input.fill("   ");
		await input.press("Enter");
		await expect(dialog).toBeVisible();
		await expect(input).toBeFocused();
		await input.fill("About");
		await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
		await expect(dialog).toBeVisible();
		await expect(input).toBeFocused();
		await input.press("Control+Enter");
		await expect(dialog).toBeVisible();
		await input.press("ArrowUp");
		const resourceSearch = dialog.getByRole("link", {
			name: "Search resources for “About”",
		});
		await expect(resourceSearch).toBeFocused();
		await resourceSearch.press("Enter");
		await expect(page).toHaveURL(
			(url) =>
				url.pathname === "/search" && url.searchParams.get("q") === "About",
		);
	});

	test("navigation shortcuts expand separately from destination links", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "Data", exact: true }).click();
		const expand = page.getByRole("button", { name: "Show Classes shortcuts" });
		await expand.click();
		await expect(expand).toHaveAttribute("aria-expanded", "true");
		await expect(
			page.getByRole("region", { name: "Classes navigation" }),
		).toBeVisible();
		const destination = page.getByRole("link", {
			name: "Classes: define object schemas inside collections",
		});
		await expect(destination).toHaveAttribute("href", "/classes");
		await destination.click();
		await expect(
			page.getByRole("region", { name: "Classes navigation" }),
		).toBeHidden();
	});

	test("Escape closes a resource lookup before its enclosing create dialog", async ({
		page,
	}) => {
		await page.getByRole("button", { name: "New class", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Create class" });
		const picker = dialog.getByRole("button", { name: "Find collection" });
		await picker.click();
		await expect(
			page.getByRole("combobox", { name: "Collection name or ID" }),
		).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeVisible();
		await expect(picker).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});

	test("pagination preserves visible rows while disabling stale actions", async ({
		page,
	}) => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(`**${prefix}/classes?*`, async (route) => {
			if (!new URL(route.request().url()).searchParams.has("cursor"))
				return route.fallback();
			await pending;
			await route.fulfill({
				json: [remoteClass],
				headers: { "X-Total-Count": "3" },
			});
		});
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		const table = page.locator("#classes-table");
		await expect(table).toHaveAttribute("aria-busy", "true");
		await expect(table).toHaveAttribute("inert", "");
		await expect(table.getByText("Devices", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Next page", exact: true }),
		).toBeDisabled();
		release();
		await expect(
			table.getByText("Remote devices", { exact: true }),
		).toBeVisible();
		await expect(table).not.toHaveAttribute("inert", "");
	});

	test("mobile navigation traps focus and restores the trigger", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(page.locator("#mobile-navigation")).toHaveAttribute(
			"inert",
			"",
		);
		const trigger = page.getByRole("button", { name: "Open navigation" });
		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "Primary navigation" });
		await expect(dialog).toBeVisible();
		const close = dialog.getByRole("button", { name: "Close navigation" });
		await expect(close).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect
			.poll(() =>
				dialog.evaluate((element) => element.contains(document.activeElement)),
			)
			.toBe(true);
		await page.keyboard.press("Tab");
		await expect(close).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(trigger).toBeFocused();
		await expect(page.locator("#mobile-navigation")).toHaveAttribute(
			"inert",
			"",
		);
	});

	test("an unavailable table can be retried in place", async ({ page }) => {
		let available = false;
		await page.route(`**${prefix}/classes?*`, (route) =>
			available
				? route.fulfill({ json: classes })
				: route.fulfill({
						status: 503,
						json: { message: "Temporary test outage" },
					}),
		);
		await page.goto("/classes");
		await expect(page.getByText(/Failed to load classes/)).toBeVisible();
		available = true;
		await page.getByRole("button", { name: "Retry", exact: true }).click();
		await expect(
			page.locator("#classes-table").getByText("Devices", { exact: true }),
		).toBeVisible();
	});

	test("class picker pages and searches beyond the first options", async ({
		page,
	}) => {
		await page.goto("/objects?classId=999");
		const picker = page.getByRole("button", { name: "Objects class context" });
		await expect(picker).toContainText("Remote devices");
		await picker.click();
		await expect(
			page.getByRole("option", { name: /Devices.*#10/ }),
		).toBeVisible();
		const popover = page.locator(".directory-lookup-popover").filter({
			has: page.getByRole("combobox", { name: "Search classes", exact: true }),
		});
		for (const width of [1440, 768, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await expect
				.poll(async () => {
					const bounds = await popover.boundingBox();
					return (
						bounds !== null &&
						bounds.x >= 8 &&
						bounds.x + bounds.width <= width - 8
					);
				})
				.toBe(true);
		}
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.getByRole("button", { name: "Load more results" }).click();
		await expect(
			page.getByRole("option", { name: /Remote devices.*#999/ }),
		).toBeVisible();
		await page
			.getByRole("combobox", { name: "Search classes", exact: true })
			.fill("Remote");
		await expect(page.getByRole("option")).toHaveCount(1);
		await expect(page.getByRole("option")).toContainText("Infrastructure (#1)");
		await page.getByRole("option").click();
		await expect(picker).toBeFocused();
	});

	test("failed sign-out keeps the session visible and the error persistent", async ({
		page,
	}) => {
		await page.route("**/_hubuum-bff/auth/logout", (route) =>
			route.fulfill({ status: 503, json: { message: "Unavailable" } }),
		);
		await page.getByRole("button", { name: /Open account menu for/ }).click();
		await page.getByRole("button", { name: "Sign out", exact: true }).click();
		const message = page.getByText(/Sign-out could not be completed/);
		await expect(message).toBeVisible();
		await expect(page).toHaveURL(/\/classes$/);
		await page.clock.install();
		await page.clock.fastForward(7000);
		await expect(message).toBeVisible();
		await page.getByRole("button", { name: "Dismiss notification" }).click();
		await expect(message).toBeHidden();
	});

	for (const theme of ["light", "dark"] as const) {
		for (const viewport of [
			{ name: "desktop", width: 1440, height: 1000 },
			{ name: "mobile", width: 390, height: 844 },
		]) {
			test(`classes layout in ${theme} mode at ${viewport.name}`, async ({
				page,
			}) => {
				await page.setViewportSize(viewport);
				await page.emulateMedia({ reducedMotion: "reduce" });
				await page
					.getByRole("button", { name: /Open account menu for/ })
					.click();
				await page
					.getByRole("button", {
						name: theme === "dark" ? "Dark" : "Light",
						exact: true,
					})
					.click();
				await page.keyboard.press("Escape");
				await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
				await page.evaluate(() => {
					document.documentElement.dataset.atmosphere = "sunset";
				});
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
				await expect
					.poll(() =>
						page.evaluate(() => document.body.scrollWidth <= innerWidth),
					)
					.toBe(true);
				const violations = (
					await new AxeBuilder({ page }).analyze()
				).violations.filter((item) =>
					["serious", "critical"].includes(item.impact ?? ""),
				);
				expect(violations).toEqual([]);
				await expect(page).toHaveScreenshot(
					`classes-${theme}-${viewport.name}.png`,
					{ animations: "disabled", fullPage: true },
				);
			});
		}
	}
});
