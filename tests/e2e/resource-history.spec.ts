import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const prefix = "/_hubuum-bff/hubuum/api/v1/classes/3";
const objectPath = "/objects/3/12/history";
const instants = [
	"2026-09-24T08:42:13.830219Z",
	"2026-09-25T08:42:13.830219Z",
	"2026-09-26T08:42:13.830219Z",
];
const base = {
	id: 12,
	hubuum_class_id: 3,
	collection_id: 4,
	name: "Edge router",
	description: "Managed gateway",
	created_at: instants[0],
	updated_at: instants[2],
};
const records = instants
	.map((at, index) => ({
		...base,
		history_id: 101 + index,
		revision: index + 1,
		op: index ? "UPDATE" : "INSERT",
		valid_from: at,
		valid_to: instants[index + 1] ?? null,
		data: {
			network: { mtu: index === 2 ? 9000 : 1500, nullable: null },
			stable: true,
		},
		provenance: { actor: {} },
	}))
	.reverse();

async function prepare(
	page: Page,
	options: {
		conflict?: boolean;
		deleted?: boolean;
		unavailable?: boolean;
		classHistory?: boolean;
	} = {},
) {
	const state = {
		live: {
			...base,
			revision: 4,
			data: { network: { mtu: 9000, added: true }, stable: true },
		},
		writes: [] as { body: unknown; etag: string | undefined }[],
		asOf: [] as string[],
	};
	const history = options.classHistory
		? records.map(({ data: _data, hubuum_class_id: _classId, ...record }) => ({
				...record,
				id: 3,
				validate_schema: true,
				json_schema: { type: "object" },
			}))
		: records.map((record) => structuredClone(record));
	if (options.deleted) history[0] = { ...history[0], op: "DELETE" };
	await page.route(`**${prefix}**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		if (url.pathname.endsWith("/history/as-of")) {
			const at = url.searchParams.get("at") ?? "";
			state.asOf.push(at);
			return route.fulfill(
				options.unavailable
					? { status: 404, json: { message: "Snapshot unavailable" } }
					: { json: history[1] },
			);
		}
		if (url.pathname.endsWith("/history"))
			return route.fulfill({
				json: url.searchParams.has("cursor")
					? [history[2]]
					: history.slice(0, 2),
				headers: url.searchParams.has("cursor")
					? {}
					: { "X-Next-Cursor": "older" },
			});
		if (request.method() === "PATCH") {
			state.writes.push({
				body: request.postDataJSON(),
				etag: request.headers()["if-match"],
			});
			if (options.conflict)
				return route.fulfill({
					status: 412,
					json: { message: "Precondition failed" },
				});
			state.live = {
				...state.live,
				revision: state.live.revision + 1,
				data: request.postDataJSON()[1].value,
			};
		}
		return route.fulfill({
			json: options.classHistory ? { ...history[0], revision: 4 } : state.live,
			headers: { ETag: `"object:12:${state.live.revision}"` },
		});
	});
	return state;
}

async function selectHistorical(page: Page) {
	await page.goto(
		`${objectPath}?at=${encodeURIComponent(instants[1])}&version=102`,
	);
	await expect(
		page.getByRole("combobox", { name: "Select a stored version" }),
	).toHaveValue("102");
}

test("history routes require a server-side session", async ({ page }) => {
	for (const path of [objectPath, "/classes/3/history"]) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/login(?:\?|$)/);
		await expect(page.getByRole("form", { name: "Login form" })).toBeVisible();
	}
});

test.describe("resource history", () => {
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
	});

	test("glides between exact stored versions, keeps pinning in the URL and loads older history", async ({
		page,
	}) => {
		await prepare(page);
		await page.goto(objectPath);
		const selector = page.getByRole("combobox", {
			name: "Select a stored version",
		});
		await expect(selector).toHaveValue("103");
		await page.getByRole("group", { name: /Snapshot navigation/ }).hover();
		await page.mouse.wheel(0, 100);
		await expect(selector).toHaveValue("102");
		expect(new URL(page.url()).searchParams.get("at")).toBe(instants[1]);
		await page.getByRole("button", { name: "Later →" }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(selector).toHaveValue("103");
		await page.keyboard.press("ArrowLeft");
		await expect(selector).toHaveValue("102");
		await page.getByRole("button", { name: "Pin as baseline" }).click();
		await page.getByRole("button", { name: "Later →" }).click();
		await expect(selector).toHaveValue("103");
		await page.reload();
		await expect(page.getByLabel("Compare with")).toHaveValue("pinned");
		await page.getByRole("button", { name: "Compare snapshots" }).click();
		await expect(
			page.getByRole("region", { name: "Snapshot comparison" }),
		).toContainText("/data/network/mtu");
		await page.getByRole("button", { name: "Load older" }).click();
		await selector.selectOption("101");
		await expect(
			page.getByRole("button", { name: "← Earlier" }),
		).toBeDisabled();
		await page.goBack();
		await expect(selector).toHaveValue("103");
		await page.getByRole("region", { name: "Snapshot comparison" }).hover();
		await page.mouse.wheel(0, 200);
		await expect(selector).toHaveValue("103");
	});

	test("continuous scrolling advances through multiple entries", async ({
		page,
	}) => {
		await prepare(page);
		await page.goto(objectPath);
		await page.getByRole("button", { name: "Load older" }).click();
		await expect(page.getByRole("button", { name: "Load older" })).toHaveCount(
			0,
		);
		await page.clock.install();
		await page.getByRole("group", { name: /Snapshot navigation/ }).hover();
		for (let tick = 0; tick < 7; tick++) {
			await page.mouse.wheel(0, 50);
			await page.clock.runFor(50);
		}
		await page.clock.runFor(200);
		await expect(
			page.getByRole("combobox", { name: "Select a stored version" }),
		).toHaveValue("101");
	});

	test("live comparison stays on the captured revision until explicitly refreshed", async ({
		page,
	}) => {
		const state = await prepare(page);
		await page.clock.install();
		await selectHistorical(page);
		await page.getByLabel("Compare with").selectOption("live");
		await expect(
			page.getByText("Live · revision 4", { exact: true }),
		).toBeVisible();
		state.live = {
			...state.live,
			revision: 5,
			data: { ...state.live.data, network: { mtu: 9500, added: true } },
		};
		await page.clock.runFor(30_100);
		await expect(page.getByText(/Live has changed/)).toBeVisible();
		await expect(
			page.getByText("Live · revision 4", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Refresh comparison" }).click();
		await expect(
			page.getByText("Live · revision 5", { exact: true }),
		).toBeVisible();
	});

	test("reviews exact subtree removals, cancels without writes and restores with a validator", async ({
		page,
	}) => {
		const state = await prepare(page);
		await selectHistorical(page);
		await page.getByRole("button", { name: "Restore to live…" }).click();
		let dialog = page.getByRole("dialog");
		await dialog
			.getByRole("checkbox", { name: "/network", exact: true })
			.check();
		await dialog.getByRole("button", { name: /Review \d+ changes/ }).click();
		await expect(
			dialog.getByRole("heading", { name: "Review changes" }),
		).toBeFocused();
		await expect(dialog).toContainText("/network/added");
		await expect(dialog).toContainText("Not present");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(state.writes).toHaveLength(0);
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toBeFocused();
		await page.getByRole("button", { name: "Restore to live…" }).click();
		dialog = page.getByRole("dialog");
		await dialog
			.getByRole("checkbox", { name: "/network", exact: true })
			.check();
		await dialog.getByRole("button", { name: /Review \d+ changes/ }).click();
		await dialog
			.getByRole("button", { name: "Restore selected values to live" })
			.click();
		await expect(
			page.getByText(/Historical values restored as a new audited update/),
		).toBeVisible();
		expect(state.writes).toEqual([
			{
				etag: '"object:12:4"',
				body: [
					{
						op: "test",
						path: "",
						value: { network: { mtu: 9000, added: true }, stable: true },
					},
					{
						op: "replace",
						path: "",
						value: { network: { mtu: 1500, nullable: null }, stable: true },
					},
				],
			},
		]);
		await expect(
			page.getByRole("combobox", { name: "Select a stored version" }),
		).toHaveValue("102");
	});

	test("conflicts require a new review and never retry automatically", async ({
		page,
	}) => {
		const state = await prepare(page, { conflict: true });
		await selectHistorical(page);
		await page.getByRole("button", { name: "Restore to live…" }).click();
		const dialog = page.getByRole("dialog");
		await dialog
			.getByRole("checkbox", { name: "Entire data document" })
			.check();
		await dialog.getByRole("button", { name: /Review \d+ changes/ }).click();
		await dialog
			.getByRole("button", { name: "Restore entire data document to live" })
			.click();
		await expect(dialog.getByRole("alert")).toContainText(
			"Nothing was restored",
		);
		await expect(
			dialog.getByRole("button", {
				name: "Restore entire data document to live",
			}),
		).toBeDisabled();
		expect(state.writes).toHaveLength(1);
		await dialog
			.getByRole("button", { name: "Refresh and review again" })
			.click();
		await expect(
			dialog.getByRole("checkbox", { name: "Entire data document" }),
		).not.toBeChecked();
		await expect(
			dialog.getByRole("button", { name: "Review 0 changes" }),
		).toBeDisabled();
	});

	test("as-of failures never substitute live data and deletion markers offer no restore", async ({
		page,
	}) => {
		const state = await prepare(page, { unavailable: true, deleted: true });
		const exact = "2026-09-25T08:42:13.830218Z";
		await page.goto(`${objectPath}?at=${encodeURIComponent(exact)}`);
		await expect(page.getByRole("alert")).toContainText("Snapshot unavailable");
		expect(state.asOf).toContain(exact);
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
		await page
			.getByRole("button", { name: "Show latest visible entry" })
			.click();
		await expect(page.getByText(/Deletion marker/)).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
	});

	test("date jumps resolve the effective interval and inconsistent version links show an error", async ({
		page,
	}) => {
		const state = await prepare(page);
		await page.goto(objectPath);
		await page.getByRole("button", { name: "Jump to date" }).click();
		await page
			.getByLabel("Date and time (UTC)")
			.fill("2026-09-25T12:00:00.123");
		await page.getByRole("button", { name: "View at time" }).click();
		await expect(
			page.getByRole("combobox", { name: "Select a stored version" }),
		).toHaveValue("102");
		expect(state.asOf).toContain("2026-09-25T12:00:00.123Z");
		await page.goto(
			`${objectPath}?at=${encodeURIComponent(instants[1])}&version=999`,
		);
		await expect(page.getByRole("alert")).toContainText("does not match");
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
	});

	test("class snapshots are read-only and clearly exclude historical object populations", async ({
		page,
	}) => {
		await prepare(page, { classHistory: true });
		await page.goto("/classes/3/history");
		await expect(
			page.getByRole("region", { name: "Class definition history" }),
		).toBeVisible();
		await expect(
			page.getByText(/Class definition history does not include/),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
		await page.getByLabel("Compare with").selectOption("live");
		await expect(
			page.getByText("Live · revision 4", { exact: true }),
		).toBeVisible();
	});

	test("snapshot and restore layouts remain accessible on mobile and in dark mode", async ({
		page,
	}) => {
		await prepare(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await selectHistorical(page);
		await page.getByRole("button", { name: "Load older" }).click();
		await page.getByRole("button", { name: "Compare snapshots" }).click();
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(value) => document.documentElement.setAttribute("data-theme", value),
				theme,
			);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			const report = await new AxeBuilder({ page })
				.include('section[aria-label="Object history"]')
				.analyze();
			expect(report.violations).toEqual([]);
		}
		await page.getByRole("button", { name: "Restore to live…" }).click();
		await page.getByRole("checkbox", { name: "Entire data document" }).check();
		await page.getByRole("button", { name: /Review \d+ changes/ }).click();
		expect(
			(await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
				.violations,
		).toEqual([]);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toBeFocused();
	});
});
