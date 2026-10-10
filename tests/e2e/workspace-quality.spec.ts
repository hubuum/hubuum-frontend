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
		).not.toHaveAttribute("data-provider-discovery", "loading", {
			timeout: 20_000,
		});
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

	test("audit filters wait for hydration before accepting changes", async ({
		page,
	}) => {
		let releaseScripts = () => {};
		const scripts = new Promise<void>((resolve) => {
			releaseScripts = resolve;
		});
		await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, async (route) => {
			await scripts;
			await route.continue();
		});
		try {
			await page.goto("/audit", { waitUntil: "commit" });
			const form = page.getByRole("form", { name: "Audit filters" });
			await expect(
				form.getByRole("combobox", { name: "Action", exact: true }),
			).toBeDisabled();
			await expect(
				form.getByRole("button", { name: "Apply filters", exact: true }),
			).toBeDisabled();
			await expect(form).toHaveAttribute("aria-busy", "true");
		} finally {
			releaseScripts();
		}

		await expect(
			page.getByRole("form", { name: "Audit filters" }),
		).toHaveAttribute("aria-busy", "false");
		await page
			.getByRole("combobox", { name: "Action", exact: true })
			.selectOption("updated");
		await page
			.getByRole("button", { name: "Apply filters", exact: true })
			.click();
		await expect(page).toHaveURL(/action=updated/);
	});

	test("audit filters and page position survive refresh and browser history", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		const requests: URLSearchParams[] = [];
		await page.route(`**${prefix}/events?*`, (route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			return route.fulfill({
				json: [],
				headers: params.has("cursor") ? {} : { "X-Next-Cursor": "audit-next" },
			});
		});
		await page.goto("/audit");
		await page
			.getByRole("combobox", { name: "Action", exact: true })
			.selectOption("updated");
		await page
			.getByRole("combobox", { name: "Collection", exact: true })
			.selectOption("1");
		await page
			.getByRole("button", { name: "Apply filters", exact: true })
			.click();
		await expect(page).toHaveURL(/action=updated/);
		await expect.poll(() => requests.at(-1)?.get("collection_id")).toBe("1");
		const filteredUrl = page.url();
		await page.reload();
		await expect(
			page.getByRole("combobox", { name: "Action", exact: true }),
		).toHaveValue("updated");
		await expect(
			page.getByRole("combobox", { name: "Collection", exact: true }),
		).toHaveValue("1");
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(page).toHaveURL(/cursor=audit-next/);
		await page.reload();
		await expect.poll(() => requests.at(-1)?.get("cursor")).toBe("audit-next");
		await page.goBack();
		await expect(page).toHaveURL(filteredUrl);
		await expect(
			page.getByRole("combobox", { name: "Action", exact: true }),
		).toHaveValue("updated");
		await page.goForward();
		await expect(page).toHaveURL(/cursor=audit-next/);
		await page.goBack();
		await expect(page).toHaveURL(filteredUrl);
		await page.goBack();
		await expect(page).toHaveURL(/\/audit$/);
		await expect(
			page.getByRole("combobox", { name: "Action", exact: true }),
		).toHaveValue("");
	});

	test("exports tab and template filters survive refresh and return navigation", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.route(`**${prefix}/export-templates*`, (route) =>
			route.fulfill({
				json: [
					{
						id: 1,
						name: "RHEL report",
						description: "Inventory",
						collection_id: 1,
						content_type: "text/plain",
						kind: "jinja",
						scope_kind: "collections",
						template: "Inventory",
						created_at: timestamp,
						updated_at: timestamp,
						revision: 1,
					},
				],
			}),
		);
		await page.route(`**${prefix}/tasks?*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.goto("/exports");
		await page.getByRole("tab", { name: /Templates/ }).click();
		await page.getByRole("searchbox", { name: "Find a template" }).fill("RHEL");
		await page
			.getByRole("combobox", { name: "Collection", exact: true })
			.selectOption("1");
		await expect(page).toHaveURL(/view=templates/);
		const filteredUrl = page.url();
		await page.reload();
		await expect(page.getByRole("tab", { name: /Templates/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(
			page.getByRole("searchbox", { name: "Find a template" }),
		).toHaveValue("RHEL");
		await expect(
			page.getByRole("combobox", { name: "Collection", exact: true }),
		).toHaveValue("1");
		await page.getByRole("button", { name: "Create new template" }).click();
		await expect(page).toHaveURL(/exports\/templates\/new/);
		await page.goBack();
		await expect(page).toHaveURL(filteredUrl);
		await expect(
			page.getByRole("searchbox", { name: "Find a template" }),
		).toHaveValue("RHEL");
		await page.getByRole("tab", { name: /History/ }).click();
		await expect(page).toHaveURL(/view=history/);
		await page.reload();
		await expect(page.getByRole("tab", { name: /History/ })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("relation views follow URL changes and Back instead of stale initial state", async ({
		page,
	}) => {
		test.setTimeout(90_000);
		await page.route(`**${prefix}/relations/classes*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.route(`**${prefix}/classes/*/related/classes*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.goto("/relations/classes?classView=direct&fromClassId=10");
		await expect(
			page.getByRole("combobox", { name: "From class", exact: true }),
		).toHaveValue("10");
		await page
			.getByRole("combobox", { name: "Class relations view" })
			.selectOption("connected");
		await expect(page).toHaveURL(/classView=connected/);
		await page.reload();
		await expect(
			page.getByRole("combobox", { name: "Class relations view" }),
		).toHaveValue("connected");
		await page.evaluate(() =>
			window.history.pushState(
				null,
				"",
				"/relations/classes?classView=direct&fromClassId=20",
			),
		);
		await expect(
			page.getByRole("combobox", { name: "Class relations view" }),
		).toHaveValue("direct");
		await expect(
			page.getByRole("combobox", { name: "From class", exact: true }),
		).toHaveValue("20");
		await page.goBack();
		await expect(
			page.getByRole("combobox", { name: "Class relations view" }),
		).toHaveValue("connected");
		await page.goForward();
		await expect(
			page.getByRole("combobox", { name: "From class", exact: true }),
		).toHaveValue("20");
	});

	test("aggregate tree keeps complete subtotals across child pages and retries", async ({
		page,
	}, testInfo) => {
		test.setTimeout(90_000);
		page.setDefaultTimeout(10_000);
		const requests: URLSearchParams[] = [];
		let finishChildren = () => {};
		const lastPage = new Promise<void>((resolve) => {
			finishChildren = resolve;
		});
		let failLeaves = true;
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
						data: { os_major: 9, os_minor: 1, os_patch: 0, cost: 10 },
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
		await page.route(
			`**${prefix}/classes/10/object-aggregates?*`,
			async (route) => {
				const params = new URL(route.request().url()).searchParams;
				requests.push(params);
				const fields = params.getAll("group_by");
				const row = (
					values: Array<number | null | undefined>,
					count: number,
					average: number,
				) => ({
					dimensions: fields.map((field, index) => ({
						field,
						state:
							values[index] === null
								? "null"
								: values[index] === undefined
									? "missing"
									: "value",
						...(values[index] == null ? {} : { value: values[index] }),
					})),
					object_count: count,
					measures: params.getAll("aggregate").map((measure) => ({
						field: measure.split(":")[1],
						operation: measure.split(":")[0],
						state: "value",
						value: average,
						value_count: count,
						skipped_count: 0,
					})),
				});
				if (fields.length === 1)
					return route.fulfill({
						json: [
							params.has("cursor") ? row([10], 80, 50) : row([9], 100, 23.45),
						],
						headers: {
							"X-Total-Count": "2",
							...(params.has("cursor") ? {} : { "X-Next-Cursor": "roots-2" }),
						},
					});
				if (fields.length === 2) {
					if (params.get("cursor") === "children-3") {
						await lastPage;
						return route.fulfill({ json: [row([9, undefined], 5, 15)] });
					}
					if (params.get("cursor") === "children-2")
						return route.fulfill({
							json: [row([9, 2], 35, 22), row([9, null], 20, 30)],
							headers: { "X-Next-Cursor": "children-3" },
						});
					return route.fulfill({
						json: [row([9, 1], 40, 7.5), row([10, 1], 80, 50)],
						headers: { "X-Next-Cursor": "children-2" },
					});
				}
				if (failLeaves) {
					failLeaves = false;
					return route.fulfill({ status: 503, json: { message: "Try again" } });
				}
				return route.fulfill({
					json: [
						row([9, 1, 0], 30, 5),
						row([9, 1, 1], 10, 15),
						row([10, 1, 0], 80, 50),
					],
				});
			},
		);
		await page.goto("/objects?classId=10&limit=2");
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
		await menu.getByRole("button", { name: "Add group by" }).click();
		await menu
			.getByRole("combobox", { name: "Group by 3", exact: true })
			.selectOption({ label: "os_patch" });
		await menu.getByRole("button", { name: "Add measure" }).click();
		await menu.getByLabel("Numeric field").selectOption({ label: "cost" });
		await menu
			.getByRole("combobox", { name: "Calculation 1", exact: true })
			.selectOption("average");
		await page.keyboard.press("Escape");
		const tree = page.getByRole("region", {
			name: "Object aggregates",
			exact: true,
		});
		const parent = tree
			.getByRole("row")
			.filter({ has: page.getByRole("button", { name: /os_major: 9$/ }) });
		await expect(parent.getByRole("cell").nth(1)).toHaveText("100");
		await expect(parent.getByRole("cell").nth(2)).toContainText("23.45");
		expect(
			requests.some((params) => params.getAll("group_by").length > 1),
		).toBe(false);
		await tree
			.getByRole("button", { name: "Expand os_major: 9", exact: true })
			.click();
		await expect(tree.getByRole("status")).toContainText(
			"4 aggregate groups loaded",
		);
		await expect(parent.getByRole("cell").nth(1)).toHaveText("100");
		finishChildren();
		await expect(
			tree.getByRole("button", { name: "Expand os_minor: 1", exact: true }),
		).toBeVisible();
		await tree
			.getByRole("button", { name: /Show more subgroups for 9/ })
			.click();
		await expect(
			tree.getByRole("button", {
				name: "Expand os_minor: (null)",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			tree.getByRole("button", {
				name: "Expand os_minor: (missing)",
				exact: true,
			}),
		).toBeVisible();
		await tree
			.getByRole("button", { name: "Expand os_minor: 1", exact: true })
			.click();
		await expect(tree.getByRole("alert")).toContainText(
			"Could not load subgroups for 1",
		);
		await expect(parent.getByRole("cell").nth(1)).toHaveText("100");
		await tree
			.getByRole("button", { name: "Retry subgroups for 1", exact: true })
			.click();
		await expect(
			tree.getByRole("row").filter({ hasText: "os_patch" }),
		).toHaveCount(2);
		await expect(parent.getByRole("cell").nth(2)).toContainText("23.45");
		await tree
			.getByRole("button", { name: "Load more groups", exact: true })
			.click();
		await tree
			.getByRole("button", { name: "Expand os_major: 10", exact: true })
			.click();
		expect(
			requests.filter((params) => params.getAll("group_by").length === 2),
		).toHaveLength(3);
		expect(
			requests
				.filter((params) => params.getAll("group_by").length > 1)
				.every(
					(params) =>
						params.get("include_total") === "false" &&
						!params.has("group_path"),
				),
		).toBe(true);
		await page.setViewportSize({ width: 390, height: 900 });
		expect(
			(
				await new AxeBuilder({ page })
					.include(".object-grouped-table-scroll")
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze()
			).violations,
		).toEqual([]);
		await page.screenshot({
			path: testInfo.outputPath("aggregate-tree-mobile.png"),
		});
		await trigger.click();
		await menu.getByLabel("Sort groups").selectOption("value-asc");
		await page.keyboard.press("Escape");
		await expect(
			tree.getByRole("button", { name: "Expand os_major: 9", exact: true }),
		).toBeVisible();
		await expect(tree.getByRole("button", { name: /^Collapse/ })).toHaveCount(
			0,
		);
	});

	test("aggregate counts use server filters and pagination with shareable links and Back restores the tree", async ({
		page,
		context,
	}, testInfo) => {
		test.setTimeout(120_000);
		page.setDefaultTimeout(10_000);
		const memberRequests: URLSearchParams[] = [];
		let failMembers = true;
		const objects = [
			{ os_major: 8, os_minor: "1" },
			{ os_major: "9", os_minor: "1" },
			{ os_major: "8", os_minor: "1" },
			{ os_major: "8", os_minor: "2" },
			{ os_major: "8", os_minor: null },
			{ os_major: "8" },
			{ os_major: "8", os_minor: "1" },
			{ os_major: "8", os_minor: "1" },
		].map((data, index) => ({
			id: 100 + index,
			name: `host-${100 + index}`,
			description: index === 7 ? "Debian" : "RHEL",
			collection_id: 1,
			hubuum_class_id: 10,
			created_at: timestamp,
			updated_at: timestamp,
			revision: 1,
			data,
			computed: {
				shared: {
					values: {},
					errors: {},
					revision: 1,
					materialization_stale: false,
				},
			},
		}));
		await context.route(`**${prefix}/classes?*`, (route) =>
			route.fulfill({ json: classes }),
		);
		await context.route(`**${prefix}/collections?*`, (route) =>
			route.fulfill({ json: [root] }),
		);
		await context.route(`**${prefix}/classes/10?*`, (route) =>
			route.fulfill({ json: classes[0] }),
		);
		await context.route(`**${prefix}/classes/10/computed-fields*`, (route) =>
			route.fulfill({ json: { fields: [] } }),
		);
		await context.route(`**${prefix}/iam/me/computed-fields*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.unroute("**/_hubuum-bff/classes/*/objects?*");
		await context.route("**/_hubuum-bff/classes/10/objects?*", (route) => {
			const params = new URL(route.request().url()).searchParams;
			const isMembers =
				params.has("json_data__regex") || params.has("json_data__is_null");
			if (isMembers) {
				memberRequests.push(params);
				if (failMembers) {
					return route.fulfill({ status: 503, json: { message: "Try again" } });
				}
			}
			const filtered = objects.filter((object) => {
				if (
					params.get("description__equals") === "RHEL" &&
					object.description !== "RHEL"
				)
					return false;
				for (const predicate of params.getAll("json_data__regex")) {
					const separator = predicate.indexOf("=");
					const value =
						object.data[
							predicate.slice(0, separator) as keyof typeof object.data
						];
					if (
						value == null ||
						!new RegExp(predicate.slice(separator + 1)).test(String(value))
					)
						return false;
				}
				return params
					.getAll("json_data__is_null")
					.every(
						(field) => object.data[field as keyof typeof object.data] == null,
					);
			});
			const offset = Number(params.get("cursor")?.replace("page-", "")) || 0;
			const limit = Number(params.get("limit"));
			return route.fulfill({
				json: filtered.slice(offset, offset + limit),
				headers: {
					"X-Total-Count": String(filtered.length),
					...(offset + limit < filtered.length
						? { "X-Next-Cursor": `page-${offset + limit}` }
						: {}),
				},
			});
		});
		await context.route(
			`**${prefix}/classes/10/object-aggregates?*`,
			(route) => {
				const params = new URL(route.request().url()).searchParams;
				const fields = params.getAll("group_by");
				const groups = new Map<
					string,
					{
						dimensions: { field: string; state: string; value?: unknown }[];
						object_count: number;
					}
				>();
				for (const object of objects.slice(0, 7)) {
					const dimensions = fields.map((field) => {
						const value =
							field === "collection_id"
								? 1
								: object.data[field.slice(10) as keyof typeof object.data];
						return {
							field,
							state:
								value === undefined
									? "missing"
									: value === null
										? "null"
										: "value",
							...(value == null ? {} : { value }),
						};
					});
					const key = JSON.stringify(dimensions);
					const group = groups.get(key) ?? { dimensions, object_count: 0 };
					group.object_count += 1;
					groups.set(key, group);
				}
				const rows = [...groups.values()].sort(
					(a, b) => b.object_count - a.object_count,
				);
				const offset = Number(params.get("cursor")) || 0;
				const limit = Number(params.get("limit"));
				return route.fulfill({
					json: rows.slice(offset, offset + limit),
					headers: {
						"X-Total-Count": String(rows.length),
						...(offset + limit < rows.length
							? { "X-Next-Cursor": String(offset + limit) }
							: {}),
					},
				});
			},
		);
		const params = new URLSearchParams({
			classId: "10",
			limit: "2",
			objectFilters: JSON.stringify([
				{ field: "description", operator: "equals", value: "RHEL" },
			]),
		});
		await page.goto(`/objects?${params}`);
		await expect(
			page.getByRole("link", { name: "host-100", exact: true }),
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
		await page.keyboard.press("Escape");
		const tree = page.getByRole("region", {
			name: "Object aggregates",
			exact: true,
		});
		await expect(
			tree.getByText("Expand a group to see its subgroups.", { exact: false }),
		).toHaveCount(0);
		const parentCount = page.getByRole("button", {
			name: "View 5 objects for os_major: 8",
			exact: true,
		});
		const parentRow = tree.getByRole("row").filter({ has: parentCount });
		await parentRow
			.getByRole("button", { name: "Expand os_major: 8", exact: true })
			.click();
		expect(memberRequests).toHaveLength(0);
		await parentCount.click();
		const dialog = page.getByRole("dialog", {
			name: /matching objects/,
		});
		await expect(dialog.getByRole("alert")).toContainText("Try again");
		failMembers = false;
		memberRequests.length = 0;
		await dialog
			.getByRole("button", { name: "Retry matching objects" })
			.click();
		const objectLinks = dialog.getByRole("link", { name: /^host-/ });
		await expect(objectLinks).toHaveText(["host-100", "host-102"]);
		await expect(dialog.getByRole("heading")).toContainText(
			"6 matching objects",
		);
		expect(memberRequests).toHaveLength(1);
		expect(memberRequests[0].get("cursor")).toBeNull();
		await expect(dialog.getByText(/checked/)).toHaveCount(0);
		await dialog.getByRole("button", { name: "Next page" }).click();
		await expect(objectLinks).toHaveText(["host-103", "host-104"]);
		expect(memberRequests.at(-1)?.get("cursor")).toBe("page-2");
		await dialog.getByRole("button", { name: "Next page" }).click();
		await expect(objectLinks).toHaveText(["host-105", "host-106"]);
		await dialog.getByRole("button", { name: "Previous page" }).click();
		await expect(objectLinks).toHaveText(["host-103", "host-104"]);
		await dialog.getByRole("button", { name: "First", exact: true }).click();
		await expect(objectLinks).toHaveText(["host-100", "host-102"]);
		const openTable = dialog.getByRole("link", {
			name: "Open in object table",
		});
		const popupPromise = context.waitForEvent("page");
		await openTable.click({ modifiers: ["Control"] });
		const popup = await popupPromise;
		await expect(popup.getByRole("link", { name: /^host-/ })).toHaveText([
			"host-100",
			"host-102",
		]);
		await popup.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(popup).toHaveURL(/cursor=page-2/);
		await popup.reload();
		await expect(popup.getByRole("link", { name: /^host-/ })).toHaveText([
			"host-103",
			"host-104",
		]);
		await expect(dialog).toBeVisible();
		await popup.close();
		await openTable.click();
		await expect(dialog).toHaveCount(0);
		await expect(page.getByRole("link", { name: /^host-/ })).toHaveText([
			"host-100",
			"host-102",
		]);
		await expect(
			page.getByText("Aggregate filter:", { exact: true }),
		).toBeVisible();
		await page.goBack();
		await expect(
			parentRow.getByRole("button", {
				name: "Collapse os_major: 8",
				exact: true,
			}),
		).toBeVisible();
		await tree
			.getByRole("button", {
				name: "View 2 objects for os_major: 8 → os_minor: 1",
				exact: true,
			})
			.click();
		await expect(objectLinks).toHaveText(["host-100", "host-102"]);
		await page.keyboard.press("Escape");
		await tree
			.getByRole("button", { name: /^Show more subgroups for 8/ })
			.click();
		const nullCount = tree.getByRole("button", {
			name: "View 1 objects for os_major: 8 → os_minor: (null)",
			exact: true,
		});
		await nullCount.click();
		await expect(objectLinks).toHaveText(["host-104", "host-105"]);
		await page.setViewportSize({ width: 390, height: 900 });
		expect(
			(
				await new AxeBuilder({ page })
					.include('[role="dialog"]')
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze()
			).violations,
		).toEqual([]);
		await page.screenshot({
			path: testInfo.outputPath("aggregate-members-mobile.png"),
		});
		await page.keyboard.press("Escape");
		await expect(nullCount).toBeFocused();
		await tree
			.getByRole("button", {
				name: "View 1 objects for os_major: 8 → os_minor: (missing)",
				exact: true,
			})
			.click();
		await expect(objectLinks).toHaveText(["host-104", "host-105"]);
		expect(
			memberRequests.every(
				(request) => request.get("description__equals") === "RHEL",
			),
		).toBe(true);
		await page.keyboard.press("Escape");
		await trigger.click();
		await menu.getByRole("button", { name: "Table view", exact: true }).click();
		await page.keyboard.press("Escape");
		await tree
			.getByRole("button", {
				name: "View 2 objects for os_major: 8 → os_minor: 1",
				exact: true,
			})
			.click();
		await expect(objectLinks).toHaveText(["host-100", "host-102"]);
	});

	test("aggregate A–Z sorts numeric text across pages in tables and trees", async ({
		page,
	}) => {
		test.setTimeout(90_000);
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
						data: { os_major: "8", os_minor: "8" },
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
			const fields = params.getAll("group_by");
			const values = ["10", "8", "9"];
			const tuples =
				fields.length === 1
					? values.map((major) => [major])
					: values.flatMap((major) => values.map((minor) => [major, minor]));
			if (params.get("sort") === "dimensions.desc") tuples.reverse();
			const offset = Number(params.get("cursor")) || 0;
			const limit = Number(params.get("limit"));
			return route.fulfill({
				json: tuples.slice(offset, offset + limit).map((tuple) => ({
					dimensions: fields.map((field, index) => ({
						field,
						state: "value",
						value: tuple[index],
					})),
					object_count: fields.length === 1 ? 3 : 1,
				})),
				headers: {
					"X-Total-Count": String(tuples.length),
					...(offset + limit < tuples.length
						? { "X-Next-Cursor": String(offset + limit) }
						: {}),
				},
			});
		});
		await page.goto("/objects?classId=10&limit=2");
		await expect(
			page.getByRole("link", { name: "rhel-host", exact: true }),
		).toBeVisible();
		const trigger = page.getByRole("button", { name: /^Aggregate/ });
		const menu = page.getByRole("dialog", { name: "Group objects" });
		await trigger.click();
		await menu
			.getByRole("combobox", { name: "Group by", exact: true })
			.selectOption({ label: "os_major" });
		await menu.getByLabel("Sort groups").selectOption("value-asc");
		await page.keyboard.press("Escape");
		const table = page.getByRole("region", {
			name: "Object aggregates",
			exact: true,
		});
		const firstColumn = table
			.getByRole("cell")
			.filter({ hasText: /^(8|9|10)$/ });
		await expect(firstColumn).toHaveText(["8", "9"]);
		const fetched = requests.length;
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(firstColumn).toHaveText(["10"]);
		await page
			.getByRole("button", { name: "Previous page", exact: true })
			.click();
		await expect(firstColumn).toHaveText(["8", "9"]);
		expect(requests).toHaveLength(fetched);
		await trigger.click();
		await menu.getByRole("button", { name: "Add group by" }).click();
		await menu
			.getByRole("combobox", { name: "Group by 2", exact: true })
			.selectOption({ label: "os_minor" });
		await page.keyboard.press("Escape");
		const roots = table.getByRole("button", {
			name: /^(Expand|Collapse) os_major:/,
		});
		await expect(roots).toHaveText([/8/, /9/]);
		await table
			.getByRole("button", { name: "Load more groups", exact: true })
			.click();
		await expect(roots).toHaveText([/8/, /9/, /10/]);
		await table
			.getByRole("button", { name: "Expand os_major: 8", exact: true })
			.click();
		const children = table
			.getByRole("row")
			.filter({ hasText: "os_minor" })
			.getByRole("cell")
			.filter({ hasText: "os_minor" });
		await expect(children).toHaveText(["8os_minor", "9os_minor"]);
		await table
			.getByRole("button", { name: /^Show more subgroups for 8/ })
			.click();
		await expect(children).toHaveText(["8os_minor", "9os_minor", "10os_minor"]);
		await trigger.click();
		await menu.getByLabel("Sort groups").selectOption("value-desc");
		await page.keyboard.press("Escape");
		await expect(roots).toHaveText([/10/, /9/]);
		await table
			.getByRole("button", { name: "Expand os_major: 10", exact: true })
			.click();
		await expect(children).toHaveText(["10os_minor", "9os_minor"]);
		await trigger.click();
		await menu.getByRole("button", { name: "Table view", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
			"10",
			"10",
			"1",
		]);
		await expect(table.getByRole("row").nth(2).getByRole("cell")).toHaveText([
			"10",
			"9",
			"1",
		]);
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(table.getByRole("row").nth(1).getByRole("cell")).toHaveText([
			"10",
			"8",
			"1",
		]);
		await expect(table.getByRole("row").nth(2).getByRole("cell")).toHaveText([
			"9",
			"10",
			"1",
		]);
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
		const view = menu.getByRole("group", { name: "Aggregate view" });
		const treeView = view.getByRole("button", { name: "Tree view" });
		const tableView = view.getByRole("button", { name: "Table view" });
		await expect(treeView).toHaveAttribute("aria-pressed", "true");
		await tableView.click();
		await expect(tableView).toHaveAttribute("aria-pressed", "true");
		await treeView.focus();
		await page.keyboard.press("Space");
		await expect(treeView).toHaveAttribute("aria-pressed", "true");
		expect(new URL(page.url()).searchParams.has("aggregateView")).toBe(false);
		await tableView.click();
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
		await expect(
			page.getByTitle("2 groups loaded, 4 total").getByText("2/4", { exact: true }),
		).toBeVisible();
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
		await expect(page.getByRole("group", { name: "Aggregate view" })).toHaveCount(0);
		await expect(
			table.getByRole("row").nth(1).getByRole("cell").nth(2),
		).toHaveText("Infrastructure (#1)");
		const configuredUrl = new URL(page.url());
		expect(configuredUrl.searchParams.getAll("groupBy")).toEqual([
			'data:["os_major"]',
			'data:["os_minor"]',
			"object:collection",
		]);
		expect(configuredUrl.searchParams.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
		]);
		expect(configuredUrl.searchParams.get("aggregateView")).toBe("table");
		await page.reload();
		await expect(
			table.getByRole("columnheader", { name: "Sum · cost" }),
		).toBeVisible();
		await trigger.click();
		await expect(
			menu.getByRole("combobox", { name: "Group by 3", exact: true }),
		).toHaveValue("object:collection");
		await expect(menu.getByLabel("Numeric field")).toHaveValue(
			"json_data.cost",
		);
		await expect(tableView).toHaveAttribute("aria-pressed", "true");
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(page).toHaveURL(/aggregateCursor=aggregate-next/);
		await expect
			.poll(() => requests.at(-1)?.get("cursor"))
			.toBe("aggregate-next");
		await page.reload();
		await expect(
			table.getByRole("row").nth(1).getByRole("cell").nth(1),
		).toHaveText("(null)");
		await page
			.getByRole("button", { name: "Previous page", exact: true })
			.click();
		await expect(
			table.getByRole("row").nth(1).getByRole("cell").nth(1),
		).toHaveText("1");
		await page.goBack();
		await expect(page).toHaveURL(/aggregateCursor=aggregate-next/);
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
		await expect(page).toHaveURL(/groupSort=value-asc/);
		const sortedUrl = page.url();
		await page.reload();
		await expect(table.getByRole("columnheader")).toHaveText([
			/os_major/,
			"Collection",
			"os_minor",
			/Count/,
			"Sum · cost",
		]);
		expect(page.url()).toBe(sortedUrl);
		await expect(
			page
				.getByTitle("4 groups loaded, 4 total")
				.getByText("Complete", { exact: true }),
		).toBeVisible();
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
		await expect(view).toHaveCount(0);
		await menu.getByRole("button", { name: "Remove grouping field 1" }).click();
		await expect.poll(() => requests.at(-1)?.getAll("group_by")).toEqual([]);
		expect(requests.at(-1)?.getAll("aggregate")).toEqual([
			"sum:json_data.cost",
		]);
		await expect(
			table.getByRole("cell", { name: "All matching objects", exact: true }),
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
			await expect(
				commands.getByText("Ctrl/⌘ K", { exact: true }),
			).toBeVisible();
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
			await page.screenshot({
				path: testInfo.outputPath("shortcut-hints.png"),
			});
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
			await expect(
				page.getByLabel("Find a destination or action"),
			).toBeFocused();
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
			await expect(
				commands.getByText("Ctrl/⌘ K", { exact: true }),
			).toBeHidden();
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
