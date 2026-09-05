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
