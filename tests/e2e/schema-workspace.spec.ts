import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
	SchemaRevisionResponse,
	SchemaWorkResponse,
} from "../../src/lib/api/generated/models";

const timestamp = "2026-09-12T10:00:00Z";
const schemaPath = "/_hubuum-bff/hubuum/api/v1/classes/10/schema";
const activeRevision: SchemaRevisionResponse = {
	class_id: 10,
	revision: 1,
	status: "active",
	validate_schema: false,
	json_schema: null,
	created_at: timestamp,
};
const proposedRevision: SchemaRevisionResponse = {
	...activeRevision,
	revision: 2,
	status: "staged",
	validate_schema: true,
	json_schema: { type: "object" },
};
function report(): SchemaWorkResponse {
	return {
		task_id: 20,
		target: { class_id: 10, revision: 2 },
		kind: "impact",
		status: "complete",
		start_epoch: 3,
		end_epoch: 3,
		current_epoch: 3,
		current_active_schema: { class_id: 10, revision: 1 },
		upper_bound: 100,
		cursor: 100,
		examined: 1,
		valid: 1,
		invalid: 0,
		not_required: 0,
		uninspectable: 0,
		stale: 0,
		invalid_samples: [],
		elapsed_millis: 25,
		batches: 1,
		created_at: timestamp,
		readiness: "compatible",
		impact: {
			baseline: { class_id: 10, revision: 1 },
			counts: {
				newly_invalid: 0,
				still_invalid: 0,
				newly_valid: 0,
				still_valid: 0,
				newly_required_valid: 1,
				no_longer_required: 0,
				unchanged_not_required: 0,
				uninspectable: 0,
			},
			failures: [],
			ungrouped_failures: 0,
		},
	};
}

async function mockSchema(
	page: Page,
	options: {
		admin?: boolean;
		incompatible?: boolean;
		conflict?: boolean;
		running?: boolean;
		legacy?: boolean;
	} = {},
) {
	let active = { ...activeRevision };
	let proposed = { ...proposedRevision };
	let work = report();
	if (options.running) work.status = "running";
	if (options.incompatible) {
		work.readiness = "incompatible";
		work.invalid = 1;
		work.valid = 0;
		if (work.impact) {
			work.impact.counts.newly_invalid = 1;
			work.impact.counts.newly_required_valid = 0;
			work.impact.failures = [
				{
					reason: { keyword: "required", missing_property: "hostname" },
					objects: 1,
					samples: [100],
				},
			];
		}
	}
	const requests: { method: string; path: string; body: unknown }[] = [];
	await page.route("**/_hubuum-bff/hubuum/api/v1/classes/10?*", (route) =>
		route.fulfill({
			json: {
				id: 10,
				name: "Devices",
				description: "Device inventory",
				collection_id: 1,
				collection: {
					id: 1,
					name: "Infrastructure",
					description: "Infrastructure",
					parent_collection_id: null,
					created_at: timestamp,
					updated_at: timestamp,
					revision: 1,
				},
				json_schema: active.json_schema,
				validate_schema: active.validate_schema,
				created_at: timestamp,
				updated_at: timestamp,
				revision: 1,
			},
		}),
	);
	await page.route(`**${schemaPath}**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.slice(schemaPath.length);
		const method = request.method();
		const body = request.postData() ? request.postDataJSON() : undefined;
		requests.push({ method, path, body });
		if (options.legacy)
			return route.fulfill({ status: 404, json: { message: "Not found" } });
		if (path === "")
			return options.admin === false
				? route.fulfill({
						status: 403,
						json: { message: "Administrator access required" },
					})
				: route.fulfill({
						json: {
							active,
							object_epoch: 3,
							counts: {
								valid: active.revision === 1 ? 0 : 1,
								invalid: 0,
								pending: 0,
								not_required: active.revision === 1 ? 1 : 0,
							},
						},
					});
		if (path === "/revisions" && method === "GET")
			return route.fulfill({
				json: [active, proposed].filter(
					(item) => item.revision > Number(url.searchParams.get("after") ?? 0),
				),
			});
		if (path === "/revisions" && method === "POST") {
			proposed = { ...proposed, ...body };
			return route.fulfill({ status: 201, json: proposed });
		}
		if (path === "/revisions/2" && method === "GET")
			return route.fulfill({ json: proposed });
		if (path === "/revisions/2" && method === "DELETE") {
			proposed.status = "abandoned";
			return route.fulfill({ json: proposed });
		}
		if (path === "/revisions/2/impact") {
			work = report();
			return route.fulfill({ status: 202, json: work });
		}
		if (path === "/revisions/2/activate") {
			if (options.conflict)
				return route.fulfill({
					status: 409,
					json: { message: "Object population changed" },
				});
			active = { ...proposed, status: "active" };
			proposed = active;
			work = {
				...work,
				task_id: 21,
				kind: "revalidation",
				impact: null,
				readiness: null,
			};
			return route.fulfill({
				json: { active, task_id: 21, dependent_rebuild_task_id: 22 },
			});
		}
		if (path.startsWith("/tasks/")) {
			if (options.admin === false)
				return route.fulfill({
					status: 403,
					json: { message: "Administrator access required" },
				});
			if (method === "DELETE")
				work = { ...work, status: "cancelled", readiness: "inconclusive" };
			return route.fulfill({ json: work });
		}
		if (path === "/objects")
			return route.fulfill({
				json:
					Number(url.searchParams.get("after")) === 50
						? {
								items: [
									{
										object_id: 100,
										object_revision: 1,
										active_schema: { class_id: 10, revision: active.revision },
										status: "pending",
									},
								],
								next_after: null,
							}
						: { items: [], next_after: 50 },
			});
		return route.fulfill({
			status: 404,
			json: { message: `Unhandled schema fixture ${method} ${path}` },
		});
	});
	return requests;
}

test.use({ trace: "off", reducedMotion: "reduce" });

test.describe("schema workspace", () => {
	test.skip(
		!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
		"Requires an authenticated test session.",
	);
	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		await expect(
			page.getByRole("form", { name: "Login form" }),
		).not.toHaveAttribute("data-provider-discovery", "loading");
		const scope = page.locator("#identity-scope");
		if (await page.locator("select#identity-scope").isVisible())
			await scope.selectOption("local");
		else if ((await scope.getAttribute("type")) !== "hidden")
			await scope.fill("local");
		await page.getByLabel("Username").fill(process.env.E2E_USERNAME ?? "");
		await page
			.getByLabel("Password", { exact: true })
			.fill(process.env.E2E_PASSWORD ?? "");
		await page.getByRole("button", { name: "Enter workspace" }).click();
		await page.waitForURL("**/app");
	});

	test("proposes, reviews and saves a revision without activating", async ({
		page,
	}, testInfo) => {
		const requests = await mockSchema(page);
		await page.goto("/classes/10/schema");
		await page
			.getByRole("button", { name: "Propose change", exact: true })
			.click();
		await page
			.getByRole("checkbox", { name: "Enforce validation on object writes" })
			.check();
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object"}');
		await page
			.getByRole("button", { name: "Continue to review changes" })
			.click();
		await expect(
			page.getByRole("heading", { name: "Changes from active revision 1" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Save revision", exact: true })
			.click();
		await expect(page).toHaveURL(/revision=2/);
		await expect(
			page.getByText("Revision 2 is saved.", { exact: false }),
		).toBeVisible();
		expect(
			requests
				.filter((item) => item.method === "POST")
				.map((item) => item.path),
		).toEqual(["/revisions"]);
		await page
			.getByRole("button", { name: "Continue to analyze impact" })
			.click();
		await page
			.getByRole("button", { name: "Analyze impact", exact: true })
			.click();
		await expect(page).toHaveURL(/task=20/);
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		await page.screenshot({
			path: testInfo.outputPath("schema-impact-desktop.png"),
			fullPage: true,
		});
	});

	test("requires explicit activation and follows its revalidation and rebuild", async ({
		page,
	}) => {
		const requests = await mockSchema(page);
		await page.goto("/classes/10/schema?revision=2&task=20&step=activate");
		await page
			.getByRole("button", { name: "Activate after compatibility checks" })
			.click();
		await expect(page.getByRole("alertdialog")).toBeVisible();
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Activate schema", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Active revision 2", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Follow computed-field rebuild #22" }),
		).toBeVisible();
		expect(
			requests.find((item) => item.path.endsWith("/activate"))?.body,
		).toEqual({
			expected_active_revision: 1,
			policy: "reject_incompatible",
			impact_task_id: 20,
		});
	});

	test("blocks incompatible activation and separates the administrator override", async ({
		page,
	}, testInfo) => {
		await mockSchema(page, { incompatible: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=activate");
		await page
			.getByRole("button", { name: "Open account menu for admin" })
			.click();
		await page.getByRole("button", { name: "Light", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
		await expect(
			page.getByRole("button", { name: "Activate after compatibility checks" }),
		).toBeDisabled();
		await expect(
			page.getByText("Missing required “hostname”", { exact: true }),
		).toBeVisible();
		await page
			.getByText("Administrator activation option", { exact: true })
			.click();
		await page
			.getByRole("button", {
				name: "Activate with pending validation…",
				exact: true,
			})
			.click();
		await expect(page.getByRole("alertdialog")).toContainText(
			"without proving existing objects compatible",
		);
		await page.keyboard.press("Escape");
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			)
			.toBe(true);
		const violations = (
			await new AxeBuilder({ page }).analyze()
		).violations.filter((item) =>
			["serious", "critical"].includes(item.impact ?? ""),
		);
		expect(violations).toEqual([]);
		await page.screenshot({
			path: testInfo.outputPath("schema-impact-mobile.png"),
			fullPage: true,
		});
		await page
			.getByRole("button", { name: "Open account menu for admin" })
			.click();
		await page.getByRole("button", { name: "Dark", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
		await page.evaluate(() => window.scrollTo(0, 0));
		const darkViolations = (
			await new AxeBuilder({ page }).analyze()
		).violations.filter((item) =>
			["serious", "critical"].includes(item.impact ?? ""),
		);
		expect(darkViolations).toEqual([]);
		await page.screenshot({
			path: testInfo.outputPath("schema-impact-mobile-dark.png"),
			fullPage: true,
		});
	});

	test("retains the proposal after a concurrent activation conflict", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { conflict: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=activate");
		await page
			.getByRole("button", { name: "Activate after compatibility checks" })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Activate schema", exact: true })
			.click();
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"The proposal is retained",
		);
		await expect(page).toHaveURL(/revision=2/);
		expect(
			requests.filter((item) => item.path.endsWith("/activate")),
		).toHaveLength(1);
	});

	test("restricts reports and provides an administrator handoff", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { admin: false });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await expect(
			page.getByText("Share the saved revision link", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Analyze impact", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByText("Administrator activation option", { exact: true }),
		).toHaveCount(0);
		expect(requests.some((item) => item.path.startsWith("/tasks/"))).toBe(
			false,
		);
	});

	test("continues past empty compliance pages and supports keyboard flow navigation", async ({
		page,
	}) => {
		await mockSchema(page);
		await page.goto("/classes/10/schema?revision=2");
		await page.getByRole("tab", { name: /1\. Propose/ }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(
			page.getByRole("tab", { name: /2\. Review changes/ }),
		).toBeFocused();
		await page
			.getByRole("button", { name: "Object compliance", exact: true })
			.click();
		await page.getByLabel("Compliance status").selectOption("pending");
		await expect(
			page.getByText("No visible objects in the loaded pages."),
		).toBeVisible();
		await page.getByRole("button", { name: "Load more objects" }).click();
		await expect(
			page.getByRole("link", { name: "Object #100", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Load more objects" }),
		).toHaveCount(0);
	});

	test("cancels running work without activating or discarding the revision", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { running: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await page
			.getByRole("button", { name: "Cancel work", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Cancel work", exact: true })
			.click();
		await expect(
			page.getByText("This work is cancelled.", { exact: false }),
		).toBeVisible();
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
	});

	test("explains the older-server fallback", async ({ page }) => {
		await mockSchema(page, { legacy: true });
		await page.goto("/classes/10/schema");
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"does not expose versioned schemas",
		);
		await expect(
			page.getByRole("link", { name: "Back to class" }),
		).toHaveAttribute("href", "/classes/10");
	});

	test("metadata editing on newer servers never resubmits the schema", async ({
		page,
	}) => {
		await mockSchema(page);
		let submitted: Record<string, unknown> | null = null;
		await page.route(
			"**/_hubuum-bff/hubuum/api/v1/classes/10",
			async (route) => {
				submitted = route.request().postDataJSON() as Record<string, unknown>;
				await route.fulfill({ json: { id: 10, ...submitted } });
			},
		);
		await page.goto("/classes/10");
		await expect(
			page.getByRole("link", { name: "Manage schema" }),
		).toBeVisible();
		await page.getByRole("button", { name: /^Edit class name\./ }).click();
		await page
			.getByRole("textbox", { name: "Class name", exact: true })
			.fill("Updated devices");
		await page
			.getByRole("button", { name: "Save changes", exact: true })
			.click();
		await expect
			.poll(() => submitted)
			.toEqual({
				name: "Updated devices",
				description: "Device inventory",
				collection_id: 1,
			});
	});

	test("older servers retain inline schema editing", async ({ page }) => {
		await mockSchema(page, { legacy: true });
		await page.goto("/classes/10");
		await page
			.getByRole("button", { name: /^Edit schema validation\./ })
			.click();
		await expect(
			page.getByRole("checkbox", {
				name: "Validate objects against JSON schema",
			}),
		).toBeVisible();
		await expect(page.getByRole("link", { name: "Manage schema" })).toHaveCount(
			0,
		);
	});
});
