import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// The non-admin regression creates a disposable credential; keep it out of artifacts.
test.use({ trace: "off", screenshot: "off", video: "off" });

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
		restoreDenied?: boolean;
		deleted?: boolean;
		unavailable?: boolean;
		classHistory?: boolean;
		missingClassEtag?: boolean;
		missingCollection?: boolean;
		collectionReadDenied?: boolean;
		classRestoreStatus?: number;
		many?: boolean;
	} = {},
) {
	const state = {
		live: {
			...base,
			revision: 4,
			data: { network: { mtu: 9000, added: true }, stable: true },
		},
		liveClass: {
			id: 3,
			name: "Live class",
			description: "Current description",
			collection_id: 4,
			revision: 4,
			validate_schema: false,
			json_schema: { type: "object" },
		},
		writes: [] as { body: unknown; etag: string | undefined }[],
		asOf: [] as string[],
	};
	const source = options.many
		? Array.from({ length: 60 }, (_, index) => ({
				...records[0],
				history_id: 1000 + index,
				revision: index + 1,
				valid_from: new Date(Date.UTC(2026, 7, 1, index)).toISOString(),
				valid_to:
					index < 59
						? new Date(Date.UTC(2026, 7, 1, index + 1)).toISOString()
						: null,
				data: { network: { mtu: 1500 + index }, stable: true },
			})).reverse()
		: records;
	const pageSize = options.many ? 25 : 2;
	const history = options.classHistory
		? source.map(({ data: _data, hubuum_class_id: _classId, ...record }) => ({
				...record,
				id: 3,
				collection_id:
					options.missingCollection || options.collectionReadDenied ? 99 : 4,
				validate_schema: true,
				json_schema: { type: "object" },
			}))
		: source.map((record) => structuredClone(record));
	if (options.missingCollection || options.collectionReadDenied)
		await page.route("**/api/v1/collections/99", (route) =>
			route.fulfill({
				status: options.missingCollection ? 404 : 403,
				json: {
					message: options.missingCollection
						? "Deleted collection"
						: "ReadCollection denied",
				},
			}),
		);
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
		if (url.pathname.endsWith("/history")) {
			const offset = Number(url.searchParams.get("cursor") ?? 0);
			return route.fulfill({
				json: history.slice(offset, offset + pageSize),
				headers:
					offset + pageSize < history.length
						? { "X-Next-Cursor": String(offset + pageSize) }
						: {},
			});
		}
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
			if (options.restoreDenied)
				return route.fulfill({
					status: 403,
					json: { message: "Object update permission denied" },
				});
			if (options.classHistory) {
				if (options.classRestoreStatus)
					return route.fulfill({
						status: options.classRestoreStatus,
						json: { message: "Class restore rejected" },
					});
				state.liveClass = {
					...state.liveClass,
					...request.postDataJSON(),
					revision: state.liveClass.revision + 1,
				};
			} else
				state.live = {
					...state.live,
					revision: state.live.revision + 1,
					data: request.postDataJSON()[1].value,
				};
		}
		return route.fulfill({
			json: options.classHistory ? state.liveClass : state.live,
			headers: options.classHistory
				? options.missingClassEtag
					? {}
					: { ETag: `"class:3:${state.liveClass.revision}"` }
				: { ETag: `"object:12:${state.live.revision}"` },
		});
	});
	return state;
}

function versionMarker(page: Page, id: number) {
	return page
		.getByRole("navigation", { name: "History timeline" })
		.getByRole("button", { name: new RegExp(`^View version #${id} ·`) });
}

async function expectSelected(page: Page, id: number) {
	await expect(versionMarker(page, id)).toHaveAttribute("aria-current", "step");
	await expect(
		page.getByText(`Stored version #${id} ·`, { exact: false }),
	).toBeVisible();
}

async function selectHistorical(page: Page) {
	await page.goto(
		`${objectPath}?at=${encodeURIComponent(instants[1])}&version=102`,
	);
	await expectSelected(page, 102);
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

	test("quiet ribbon keeps comparison controls above the timestamp-led snapshot", async ({
		page,
	}) => {
		await prepare(page);
		await selectHistorical(page);
		const ribbon = page.getByRole("group", {
			name: "History comparison and navigation",
		});
		const snapshot = page.getByRole("region", {
			name: "Selected snapshot",
			exact: true,
		});
		const baseline = ribbon.getByRole("combobox", { name: "Compare with" });
		const pin = ribbon.getByRole("button", { name: "Pin as baseline" });
		const compare = ribbon.getByRole("button", { name: "Compare snapshots" });
		await expect(baseline).toHaveValue("previous");
		await expect(snapshot.getByRole("combobox")).toHaveCount(0);
		await expect(snapshot.getByRole("heading", { level: 2 })).not.toContainText(
			base.name,
		);
		await expect(
			snapshot.getByRole("heading", { level: 2 }).locator("time"),
		).toHaveAttribute("datetime", instants[1]);
		const ribbonBounds = await ribbon.boundingBox();
		const snapshotBounds = await snapshot.boundingBox();
		const compareBounds = await compare.boundingBox();
		const jumpBounds = await ribbon
			.getByRole("button", { name: "Jump to date" })
			.boundingBox();
		if (!ribbonBounds || !snapshotBounds || !compareBounds || !jumpBounds)
			throw new Error("The ribbon, snapshot and navigation must be visible");
		expect(ribbonBounds.y + ribbonBounds.height).toBeLessThan(snapshotBounds.y);
		expect(compareBounds.x + compareBounds.width).toBeLessThan(jumpBounds.x);
		await pin.click();
		await expect(pin).toHaveAttribute("aria-pressed", "true");
		await expect(baseline).toHaveValue("pinned");
		await versionMarker(page, 103).click();
		await expectSelected(page, 103);
		await expect(pin).toHaveAttribute("aria-pressed", "false");
		await compare.click();
		await expect(ribbon.getByLabel("Only changes")).toBeChecked();
		await ribbon.getByLabel("Only changes").uncheck();
		await expect(
			snapshot.getByText("Unchanged", { exact: true }).first(),
		).toBeVisible();
		await ribbon.getByRole("button", { name: "Close comparison" }).click();
		await expect(
			snapshot.getByText("Snapshot JSON", { exact: true }),
		).toBeVisible();
	});

	test("timeline scrolling, markers and keys preserve exact versions and pinned comparisons", async ({
		page,
	}) => {
		await prepare(page);
		await page.goto(objectPath);
		await expectSelected(page, 103);
		const titlebar = page.locator("header.topbar");
		await expect(titlebar).toBeVisible();
		await expect(titlebar.getByRole("heading")).toHaveCount(0);
		await expect(page.getByRole("heading", { level: 1 })).toContainText(
			"no known end",
		);
		await expect(page.getByText("Object history", { exact: true })).toHaveCount(
			0,
		);
		await expect(page.getByText("Read-only", { exact: true })).toHaveCount(0);
		await expect(
			page.getByText(/^(?:Newer ↑|Older ↓|↑ Newer|↓ Older)$/),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /Earlier|Later/ }),
		).toHaveCount(0);
		await expect(
			page.getByRole("combobox", { name: "Select a stored version" }),
		).toHaveCount(0);
		await versionMarker(page, 103).hover();
		await page.mouse.wheel(0, 80);
		await expectSelected(page, 102);
		expect(new URL(page.url()).searchParams.get("at")).toBe(instants[1]);
		const heading = page.getByRole("heading", { level: 1 });
		await expect(heading).toContainText("→");
		await expect(heading).toContainText("(exclusive)");
		await expect(heading.locator("time").first()).toHaveAttribute(
			"datetime",
			instants[1],
		);
		await expect(heading.locator("time").last()).toHaveAttribute(
			"datetime",
			instants[2],
		);
		await versionMarker(page, 102).focus();
		await page.keyboard.press("ArrowUp");
		await expectSelected(page, 103);
		await page.keyboard.press("ArrowDown");
		await expectSelected(page, 102);
		await page.getByRole("button", { name: "Pin as baseline" }).click();
		await versionMarker(page, 103).click();
		await expectSelected(page, 103);
		await page.reload();
		await expect(page.getByLabel("Compare with")).toHaveValue("pinned");
		await page.getByRole("button", { name: "Compare snapshots" }).click();
		await expect(
			page.getByRole("region", { name: "Snapshot comparison" }),
		).toContainText("/data/network/mtu");
		await versionMarker(page, 103).focus();
		await page.keyboard.press("ArrowDown");
		await expect(versionMarker(page, 101)).toBeAttached();
		await page.keyboard.press("End");
		await expectSelected(page, 101);
		await page.goBack();
		await expectSelected(page, 102);
		await page.getByRole("region", { name: "Snapshot comparison" }).hover();
		await page.mouse.wheel(0, 200);
		await expectSelected(page, 102);
	});

	test("a deep fan follows continuous timeline scrolling and loads older pages automatically", async ({
		page,
	}, testInfo) => {
		await prepare(page, { many: true });
		await page.goto(objectPath);
		await expectSelected(page, 1059);
		const timeline = page.getByRole("navigation", { name: "History timeline" });
		await expect(timeline.getByText("0 newer", { exact: true })).toBeVisible();
		await expect(timeline.getByText("24 older", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("img", {
				name: "Older snapshot fan, 24 older versions loaded",
			}),
		).toBeVisible();
		await versionMarker(page, 1059).hover();
		for (let tick = 1; tick <= 6; tick++) {
			await page.mouse.wheel(0, 80);
			await expectSelected(page, 1059 - tick);
		}
		await expectSelected(page, 1053);
		await expect(timeline.getByText("6 newer", { exact: true })).toBeVisible();
		await expect(timeline.getByText("18 older", { exact: true })).toBeVisible();
		const newerFan = page.getByRole("img", {
			name: "Newer snapshot fan, 6 newer versions loaded",
		});
		const olderFan = page.getByRole("img", {
			name: "Older snapshot fan, 18 older versions loaded",
		});
		await expect(newerFan).toBeVisible();
		await expect(olderFan).toBeVisible();
		await expect(newerFan.locator("time")).toHaveCount(4);
		await expect(olderFan.locator("time")).toHaveCount(4);
		const newerBounds = await newerFan.boundingBox();
		const olderBounds = await olderFan.boundingBox();
		const timelineBounds = await page
			.getByRole("navigation", { name: "History timeline" })
			.boundingBox();
		const selectedPanel = page.getByRole("region", {
			name: "Selected snapshot",
			exact: true,
		});
		const selectedBounds = await selectedPanel.boundingBox();
		if (!newerBounds || !selectedBounds || !olderBounds || !timelineBounds)
			throw new Error(
				"Both history directions and the selected snapshot must be visible",
			);
		expect(newerBounds.y + newerBounds.height).toBeLessThan(selectedBounds.y);
		expect(selectedBounds.y + selectedBounds.height).toBeLessThan(
			olderBounds.y,
		);
		expect(timelineBounds.height).toBeGreaterThanOrEqual(
			olderBounds.y + olderBounds.height - newerBounds.y,
		);
		const screenshotPath = testInfo.outputPath("quiet-ribbon-stack.png");
		await page.screenshot({ path: screenshotPath });
		await testInfo.attach("quiet-ribbon-stack", {
			path: screenshotPath,
			contentType: "image/png",
		});
		await selectedPanel.focus();
		await page.keyboard.press("End");
		await expect
			.poll(() => selectedPanel.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		await page.keyboard.press("Home");
		await expectSelected(page, 1053);
		await versionMarker(page, 1053).focus();
		await page.keyboard.press("End");
		await expectSelected(page, 1035);
		await expect(versionMarker(page, 1010)).toBeAttached();
		await expect(timeline.getByText("25 older", { exact: true })).toBeVisible();
		await page.keyboard.press("ArrowDown");
		await expectSelected(page, 1034);
		await page.keyboard.press("Home");
		await expectSelected(page, 1059);
		for (let step = 1; step <= 6; step++) {
			await page.keyboard.press("ArrowDown");
			await expectSelected(page, 1059 - step);
		}
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await expectSelected(page, 1053);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(
			(
				await new AxeBuilder({ page })
					.include('section[aria-label="Object history"]')
					.analyze()
			).violations,
		).toEqual([]);
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
		await expectSelected(page, 102);
	});

	test.describe("non-admin restoration", () => {
		test("can review restoration without collection permission provenance", async ({
			page,
			browser,
		}) => {
			const origin = new URL(page.url()).origin;
			const username = `history-review-${randomUUID()}`;
			const password = randomUUID();
			const created = await page.request.post(
				"/_hubuum-bff/credential-mutations",
				{
					headers: { Origin: origin },
					data: {
						password: process.env.E2E_PASSWORD,
						path: "/api/v1/iam/users",
						method: "POST",
						body: { name: username, password },
					},
				},
			);
			expect(created.status()).toBe(201);
			const user = await created.json();
			const context = await browser.newContext({ baseURL: origin });
			try {
				const login = await context.request.post("/_hubuum-bff/auth/login", {
					headers: { Origin: origin },
					data: { username, password, identity_scope: "local" },
				});
				expect(login.status()).toBe(200);
				const adminProbe = await context.request.get(
					"/_hubuum-bff/hubuum/api/v0/meta/db",
				);
				expect(adminProbe.status()).toBe(403);
				const reader = await context.newPage();
				await prepare(reader);
				let provenanceRequests = 0;
				await reader.route(
					"**/collections/*/permissions/effective/principal/*",
					(route) => {
						provenanceRequests++;
						return route.fulfill({
							status: 501,
							json: { message: "Permission provenance is unavailable" },
						});
					},
				);
				await selectHistorical(reader);
				await reader.getByRole("button", { name: "Restore to live…" }).click();
				const dialog = reader.getByRole("dialog");
				await dialog
					.getByRole("checkbox", { name: "Entire data document" })
					.check();
				await dialog
					.getByRole("button", { name: /Review \d+ changes/ })
					.click();
				await expect(
					dialog.getByRole("heading", { name: "Review changes" }),
				).toBeVisible();
				expect(provenanceRequests).toBe(0);
			} finally {
				await context.close();
				const removed = await page.request.delete(
					`/_hubuum-bff/hubuum/api/v1/iam/users/${user.id}`,
					{
						headers: { Origin: origin },
					},
				);
				expect(removed.status()).toBe(204);
			}
		});
	});

	test("server-denied restores keep live data unchanged and require a new review", async ({
		page,
	}) => {
		const state = await prepare(page, { restoreDenied: true });
		const liveData = structuredClone(state.live.data);
		await selectHistorical(page);
		await page.getByRole("button", { name: "Restore to live…" }).click();
		const dialog = page.getByRole("dialog");
		await dialog
			.getByRole("checkbox", { name: "Entire data document" })
			.check();
		await dialog.getByRole("button", { name: /Review \d+ changes/ }).click();
		const restore = dialog.getByRole("button", {
			name: "Restore entire data document to live",
		});
		await restore.click();
		await expect(dialog.getByRole("alert")).toContainText(
			"Object update permission denied",
		);
		await expect(restore).toBeDisabled();
		expect(state.writes).toHaveLength(1);
		expect(state.live.data).toEqual(liveData);
		await expect(
			page.getByText(/Historical values restored as a new audited update/),
		).toHaveCount(0);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expectSelected(page, 102);
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
		await expect(
			page.getByRole("region", { name: "Object history" }).getByRole("alert"),
		).toContainText("Snapshot unavailable");
		expect(state.asOf).toContain(exact);
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
		await expect(page.getByLabel("Compare with")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Jump to date" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Show latest visible entry" })
			.click();
		await expect(page.getByText(/Deletion marker/)).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
		await expect(page.getByLabel("Compare with")).toHaveCount(0);
	});

	test("date jumps resolve the effective interval and inconsistent version links show an error", async ({
		page,
	}) => {
		const state = await prepare(page);
		await page.goto(objectPath);
		await expectSelected(page, 103);
		await page.getByRole("button", { name: "Jump to date" }).click();
		const dialog = page.getByRole("dialog", { name: "Jump to date" });
		await dialog
			.getByLabel("Date and time (UTC)")
			.fill("2026-09-25T12:00:00.123");
		await dialog.getByRole("button", { name: "View at time" }).click();
		await expectSelected(page, 102);
		expect(state.asOf).toContain("2026-09-25T12:00:00.123Z");
		await page.goto(
			`${objectPath}?at=${encodeURIComponent(instants[1])}&version=999`,
		);
		await expect(
			page.getByRole("region", { name: "Object history" }).getByRole("alert"),
		).toContainText("does not match");
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toHaveCount(0);
	});

	test("class snapshots clearly exclude historical object populations", async ({
		page,
	}) => {
		await prepare(page, { classHistory: true });
		await page.goto("/classes/3/history");
		await expect(
			page.getByRole("region", { name: "Class definition history" }),
		).toBeVisible();
		await expect(
			page.getByText(/Class definition history does not include/),
		).toContainText(
			"Class restoration supports names, descriptions, and collection assignments.",
		);
		await expect(
			page.getByRole("button", { name: "Restore to live…" }),
		).toBeVisible();
		await page.getByLabel("Compare with").selectOption("live");
		await expect(
			page.getByText("Live · revision 4", { exact: true }),
		).toBeVisible();
	});

	test("class restoration reviews fresh metadata, cancels, and applies one conditional update", async ({
		page,
	}) => {
		const state = await prepare(page, { classHistory: true });
		await page.goto(
			`/classes/3/history?at=${encodeURIComponent(instants[1])}&version=102`,
		);
		const trigger = page.getByRole("button", { name: "Restore to live…" });
		await trigger.click();
		const dialog = page.getByRole("dialog", {
			name: "Restore historical class fields",
		});
		await expect(
			dialog.getByRole("checkbox", { name: "Schema and validation (blocked)" }),
		).toBeDisabled();
		await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
		await dialog
			.getByRole("checkbox", { name: "description", exact: true })
			.check();
		state.liveClass.revision = 5;
		await dialog
			.getByRole("button", { name: "Review selected fields" })
			.click();
		await expect(
			dialog.getByRole("heading", { name: "Review changes" }),
		).toBeFocused();
		await expect(dialog).toContainText("Live revision: 5");
		await expect(dialog).toContainText("Current live");
		await expect(dialog).toContainText("Proposed result");
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		expect(state.writes).toHaveLength(0);
		await expect(trigger).toBeFocused();
		await trigger.click();
		await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
		await dialog
			.getByRole("checkbox", { name: "description", exact: true })
			.check();
		await dialog
			.getByRole("button", { name: "Review selected fields" })
			.click();
		await dialog
			.getByRole("button", { name: "Restore 2 selected class fields" })
			.click();
		await expect(
			page.getByText(
				/Historical class fields restored as a new audited update/,
			),
		).toBeVisible();
		expect(state.writes).toEqual([
			{
				etag: '"class:3:5"',
				body: { name: base.name, description: base.description },
			},
		]);
		expect(state.liveClass.validate_schema).toBe(false);
		await expectSelected(page, 102);
	});

	test("class restoration can move to a collection without ReadCollection", async ({
		page,
	}) => {
		const state = await prepare(page, {
			classHistory: true,
			collectionReadDenied: true,
		});
		await page.goto(
			`/classes/3/history?at=${encodeURIComponent(instants[1])}&version=102`,
		);
		await page.getByRole("button", { name: "Restore to live…" }).click();
		const dialog = page.getByRole("dialog", {
			name: "Restore historical class fields",
		});
		await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
		await dialog
			.getByRole("checkbox", { name: "collection_id", exact: true })
			.check();
		await dialog
			.getByRole("button", { name: "Review selected fields" })
			.click();
		await expect(
			dialog.getByRole("heading", { name: "Review changes" }),
		).toBeFocused();
		await expect(dialog).toContainText("collection_id");
		await expect(dialog).toContainText("99");
		expect(state.writes).toHaveLength(0);
		await dialog
			.getByRole("button", { name: "Restore 2 selected class fields" })
			.click();
		await expect(
			page.getByText(
				/Historical class fields restored as a new audited update/,
			),
		).toBeVisible();
		expect(state.writes).toEqual([
			{ etag: '"class:3:4"', body: { name: base.name, collection_id: 99 } },
		]);
		expect(state.liveClass.collection_id).toBe(99);
		await expectSelected(page, 102);
	});

	for (const status of [403, 404, 412, 422]) {
		test(`class restoration requires a fresh review after ${status}`, async ({
			page,
		}) => {
			const state = await prepare(page, {
				classHistory: true,
				classRestoreStatus: status,
				collectionReadDenied: status === 403,
			});
			const before = structuredClone(state.liveClass);
			await page.goto("/classes/3/history");
			await page.getByRole("button", { name: "Restore to live…" }).click();
			const dialog = page.getByRole("dialog", {
				name: "Restore historical class fields",
			});
			await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
			if (status === 403)
				await dialog
					.getByRole("checkbox", { name: "collection_id", exact: true })
					.check();
			const confirmLabel = `Restore ${status === 403 ? 2 : 1} selected class fields`;
			await dialog
				.getByRole("button", { name: "Review selected fields" })
				.click();
			await dialog.getByRole("button", { name: confirmLabel }).click();
			await expect(dialog.getByRole("alert")).toContainText(
				"Fetch a fresh review",
			);
			await expect(
				dialog.getByRole("button", { name: confirmLabel }),
			).toHaveCount(0);
			expect(state.writes).toHaveLength(1);
			expect(state.liveClass).toEqual(before);
		});
	}

	for (const blocked of ["validator", "collection"] as const) {
		test(`class review blocks missing ${blocked} without writing any fields`, async ({
			page,
		}) => {
			const state = await prepare(page, {
				classHistory: true,
				missingClassEtag: blocked === "validator",
				missingCollection: blocked === "collection",
			});
			await page.goto("/classes/3/history");
			await page.getByRole("button", { name: "Restore to live…" }).click();
			const dialog = page.getByRole("dialog", {
				name: "Restore historical class fields",
			});
			await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
			await dialog
				.getByRole("checkbox", { name: "collection_id", exact: true })
				.check();
			await dialog
				.getByRole("button", { name: "Review selected fields" })
				.click();
			await expect(dialog.getByRole("alert")).toContainText(
				blocked === "validator"
					? "strong revision validator"
					: "historical collection is deleted",
			);
			expect(state.writes).toHaveLength(0);
		});
	}

	test("class restore no-ops remain accessible on mobile in both themes", async ({
		page,
	}) => {
		const state = await prepare(page, { classHistory: true });
		state.liveClass.name = base.name;
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/classes/3/history");
		await expectSelected(page, 103);
		for (const theme of ["light", "dark"]) {
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
			const trigger = page.getByRole("button", { name: "Restore to live…" });
			await trigger.click();
			const dialog = page.getByRole("dialog", {
				name: "Restore historical class fields",
			});
			await dialog.getByRole("checkbox", { name: "name", exact: true }).check();
			await dialog
				.getByRole("button", { name: "Review selected fields" })
				.click();
			await expect(dialog).toContainText("No update is needed");
			await expect(
				dialog.getByRole("button", { name: "Restore 1 selected class fields" }),
			).toBeDisabled();
			expect(
				(await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
					.violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			await page.keyboard.press("Escape");
			await expect(trigger).toBeFocused();
		}
		expect(state.writes).toHaveLength(0);
	});

	test("snapshot and restore layouts remain accessible on mobile and in dark mode", async ({
		page,
	}, testInfo) => {
		await prepare(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await selectHistorical(page);
		await expect(versionMarker(page, 101)).toBeAttached();
		await page.getByRole("button", { name: "Compare snapshots" }).click();
		for (const width of [320, 390, 736, 1024]) {
			await page.setViewportSize({ width, height: 844 });
			for (const theme of ["light", "dark"]) {
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
				await expectSelected(page, 102);
				await expect
					.poll(() =>
						versionMarker(page, 102).evaluate((button) => {
							const viewport = button.closest("ol")?.parentElement;
							if (!viewport)
								throw new Error("The timeline viewport must be present");
							const marker = button.getBoundingClientRect();
							const bounds = viewport.getBoundingClientRect();
							return Math.abs(
								marker.y + marker.height / 2 - bounds.y - bounds.height / 2,
							);
						}),
					)
					.toBeLessThan(2);
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= window.innerWidth,
					),
				).toBe(true);
				await expect(page.getByLabel("Compare with")).toBeVisible();
				await expect(
					page.getByRole("button", { name: "Jump to date" }),
				).toBeVisible();
				const report = await new AxeBuilder({ page })
					.include('section[aria-label="Object history"]')
					.analyze();
				expect(report.violations).toEqual([]);
				const screenshotPath = testInfo.outputPath(
					`quiet-ribbon-${width}-${theme}.png`,
				);
				await page.screenshot({ path: screenshotPath });
				await testInfo.attach(`quiet-ribbon-${width}-${theme}`, {
					path: screenshotPath,
					contentType: "image/png",
				});
			}
		}
		await page.setViewportSize({ width: 320, height: 844 });
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
