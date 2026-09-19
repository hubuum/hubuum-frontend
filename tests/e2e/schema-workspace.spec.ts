import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Route, test } from "@playwright/test";
import type {
	SchemaRevisionResponse,
	SchemaWorkResponse,
} from "../../src/lib/api/generated/models";
import { SCHEMA_REPORT_SANDBOX_POLICY } from "../../src/lib/security-policy";

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

function largeFailureReport(): SchemaWorkResponse {
	const work = report();
	if (!work.impact) throw new Error("Impact fixture required");
	work.impact.failures = Array.from({ length: 25 }, (_, group) => {
		const objects = group === 0 ? 8192 : 7;
		return {
			reason: { keyword: "required", missing_property: `field_${group + 1}` },
			objects,
			samples: Array.from(
				{ length: objects },
				(_, object) => 1000 + group * 10000 + object,
			),
		};
	});
	work.invalid = 8192 + 24 * 7;
	work.examined = work.invalid;
	work.valid = 0;
	work.invalid_samples = work.impact.failures[0].samples.slice(0, 20);
	work.impact.counts.newly_invalid = work.invalid;
	work.impact.counts.newly_required_valid = 0;
	work.cursor = 241006;
	work.upper_bound = work.cursor;
	work.readiness = "incompatible";
	return work;
}

function diagnosticReport(): SchemaWorkResponse {
	const work = report();
	if (!work.impact) throw new Error("Impact fixture required");
	work.invalid = work.examined = 12;
	work.valid = 0;
	work.readiness = "incompatible";
	work.impact.counts.newly_invalid = 12;
	work.impact.counts.newly_required_valid = 0;
	const reason = {
		keyword: "required",
		missing_property: "hostname",
		schema_path: "/required",
	};
	work.impact.failures = [
		{
			reason,
			objects: 12,
			samples: Array.from({ length: 12 }, (_, i) => 100 + i),
		},
	];
	work.impact.findings = work.impact.failures[0].samples.map((object_id) => ({
		object_id,
		reason,
		snapshot: null,
	}));
	work.impact.findings[0].snapshot = {
		object_revision: 7,
		inspected_at: timestamp,
		diagnostics: {
			truncated: true,
			issues: [
				{
					reason,
					message: "Required property hostname is missing.",
					instance_path: "",
					expected: { status: "available", value: ["hostname"] },
					actual: { object: { properties: 1 } },
					alternative: false,
					omissions: [],
				},
				{
					reason: {
						keyword: "type",
						schema_path: "/properties/interfaces/items/properties/address/type",
					},
					message: "Expected a string at this location.",
					instance_path: "/interfaces/3/address",
					expected: { status: "available", value: "string" },
					actual: "number",
					alternative: false,
					omissions: ["actual_value_redacted"],
				},
				{
					reason: { keyword: "const" },
					message: "Alternative permits a null value.",
					instance_path: "/nullable",
					expected: { status: "available", value: null },
					actual: { string: { characters: 5 } },
					alternative: true,
					omissions: ["actual_value_redacted"],
				},
				{
					reason: { keyword: "type" },
					message: "Reported text: <img src=x onerror=alert(1)>",
					instance_path: null,
					expected: { status: "omitted" },
					actual: "boolean",
					alternative: false,
					omissions: [
						"actual_value_redacted",
						"instance_path_redacted_or_too_long",
						"schema_constraint_unavailable_or_too_large",
					],
				},
			],
		},
	};
	return work;
}

async function mockRepairReports(page: Page, initiallyStored = false) {
	const generated: unknown[] = [];
	let failure = 0;
	let stored = initiallyStored;
	const html = `<!doctype html><html lang="en"><head><title>Schema repair report</title></head><body><h1>Schema repair report</h1><p>Saved object revision 7</p><a href="${new URL(page.url()).origin}/objects/10/100" target="_blank" rel="noopener noreferrer">Object #100</a><script>document.body.dataset.scriptExecuted = 'yes'</script></body></html>`;
	const handler = async (route: Route) => {
		if (route.request().method() === "POST") {
			generated.push(route.request().postDataJSON());
			if (failure)
				return route.fulfill({
					status: failure,
					json: { message: "Report output limit exceeded" },
				});
			stored = true;
		}
		if (!stored)
			return route.fulfill({
				status: 404,
				json: { message: "No saved report" },
			});
		return route.fulfill({
			body: html,
			headers: {
				"Content-Type": "text/html;charset=utf-8",
				"Content-Security-Policy": SCHEMA_REPORT_SANDBOX_POLICY,
				...(new URL(route.request().url()).searchParams.has("download")
					? {
							"Content-Disposition":
								'attachment; filename="schema-repair-20.html"',
						}
					: {}),
			},
		});
	};
	await page.route(`**${schemaPath}/tasks/20/report*`, handler);
	await page.context().route(`**${schemaPath}/tasks/20/report*`, handler);
	return {
		generated,
		html,
		failGeneration: (status: number) => {
			failure = status;
		},
	};
}

async function downloadReport(
	page: Page,
	partial = false,
): Promise<SchemaWorkResponse> {
	const downloadPromise = page.waitForEvent("download");
	await page
		.getByRole("button", {
			name: partial
				? "Download partial report (JSON)"
				: "Download report (JSON)",
			exact: true,
		})
		.click();
	const download = await downloadPromise;
	const stream = await download.createReadStream();
	if (!stream) throw new Error("The report download did not provide a stream.");
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return JSON.parse(
		Buffer.concat(chunks).toString("utf8"),
	) as SchemaWorkResponse;
}

async function mockSchema(
	page: Page,
	options: {
		admin?: boolean;
		active?: SchemaRevisionResponse;
		proposed?: SchemaRevisionResponse;
		nextStagedRevision?: number;
		incompatible?: boolean;
		conflict?: boolean;
		running?: boolean;
		legacy?: boolean;
		status?: SchemaWorkResponse["status"];
		stale?: boolean;
		empty?: boolean;
		analysisError?: boolean;
		work?: SchemaWorkResponse;
	} = {},
) {
	let active = { ...(options.active ?? activeRevision) };
	let proposed = { ...(options.proposed ?? proposedRevision) };
	let work = structuredClone(options.work ?? report());
	if (options.running) work.status = "running";
	if (options.status) work.status = options.status;
	if (options.stale) work.current_epoch = 4;
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
	const impactWork = structuredClone(work);
	let nextStagedRevision = options.nextStagedRevision ?? 2;
	const snapshots = new Map<number, SchemaRevisionResponse>();
	const snapshotWork = new Map<number, SchemaWorkResponse>();
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
								valid: active.revision === 1 || options.empty ? 0 : 1,
								invalid: 0,
								pending: 0,
								not_required: active.revision === 1 && !options.empty ? 1 : 0,
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
			const saved: SchemaRevisionResponse = {
				...proposed,
				...body,
				revision: nextStagedRevision++,
				status: "staged",
			};
			if (saved.revision === 2) proposed = saved;
			else snapshots.set(saved.revision, saved);
			return route.fulfill({ status: 201, json: saved });
		}
		const snapshot = snapshots.get(Number(path.split("/")[2]));
		if (snapshot && method === "GET") return route.fulfill({ json: snapshot });
		if (snapshot && path.endsWith("/impact")) {
			const check: SchemaWorkResponse = {
				...report(),
				task_id: 30,
				status: options.running ? "running" : "complete",
				target: { class_id: 10, revision: snapshot.revision },
			};
			snapshotWork.set(check.task_id, check);
			return route.fulfill({ status: 202, json: check });
		}
		if (path === "/revisions/1" && method === "GET")
			return route.fulfill({ json: active });
		if (path === "/revisions/2" && method === "GET")
			return route.fulfill({ json: proposed });
		if (path === "/revisions/2" && method === "DELETE") {
			proposed.status = "abandoned";
			return route.fulfill({ json: proposed });
		}
		if (path === "/revisions/2/impact") {
			if (options.analysisError)
				return route.fulfill({
					status: 503,
					json: { message: "Analysis unavailable. Try again." },
				});
			work = structuredClone(impactWork);
			if (!proposed.validate_schema) {
				work.valid = 0;
				work.not_required = work.examined;
			}
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
			const check = snapshotWork.get(Number(path.split("/")[2]));
			if (check) {
				if (method === "DELETE") check.status = "cancelled";
				return route.fulfill({ json: check });
			}
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
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object"}');
		await page.getByRole("button", { name: "Continue to validation" }).click();
		await page
			.getByRole("checkbox", { name: "Enforce validation on object writes" })
			.check();
		await page
			.getByRole("button", { name: "Continue to review & test" })
			.click();
		await expect(
			page.getByRole("heading", { name: "What will change" }),
		).toBeVisible();
		const changes = page.getByRole("article", { name: "Proposed changes" });
		await expect(
			changes.getByText("Add the proposed schema.", { exact: true }),
		).toBeVisible();
		await expect(changes.locator("pre").first()).toBeHidden();
		await changes.getByText("View schema changes", { exact: true }).click();
		await expect(changes.locator("pre").last()).toContainText(
			'"type": "object"',
		);
		await expect(changes).not.toContainText("/validate_schema");
		await changes.getByText("View schema changes", { exact: true }).click();
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
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(page).toHaveURL(/task=20/);
		await expect(
			page.getByRole("tab", { name: /3\. Review & test/ }),
		).toHaveAttribute("aria-selected", "true");
		expect(
			requests.filter(
				(item) => item.path.endsWith("/impact") && item.method === "POST",
			),
		).toHaveLength(1);
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		expect(
			requests.filter(
				(item) => item.path.endsWith("/impact") && item.method === "POST",
			),
		).toHaveLength(1);
		await expect(
			page.getByRole("button", { name: "Continue to review activation" }),
		).toBeEnabled();
		await expect(page.getByRole("tab", { name: /4\. Activate/ })).toBeEnabled();
		await page.getByRole("tab", { name: /2\. Validation/ }).click();
		await page
			.getByRole("button", { name: "View findings", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		expect(
			requests.filter(
				(item) => item.path.endsWith("/impact") && item.method === "POST",
			),
		).toHaveLength(1);
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("schema-impact-desktop.png"),
			fullPage: true,
		});
	});

	for (const enable of [true, false]) {
		test(`explains ${enable ? "enabling" : "disabling"} validation without a JSON policy diff`, async ({
			page,
		}, testInfo) => {
			await mockSchema(page, {
				active: {
					...activeRevision,
					json_schema: { type: "object" },
					validate_schema: !enable,
				},
				proposed: { ...proposedRevision, validate_schema: enable },
			});
			await page.goto("/classes/10/schema?revision=2&step=review");
			const changes = page.getByRole("article", { name: "Proposed changes" });
			await expect(
				changes.getByText(
					enable ? "Enable schema validation" : "Turn off schema validation",
					{ exact: true },
				),
			).toBeVisible();
			await expect(changes).toContainText("The schema itself is unchanged.");
			await expect(changes).toContainText(
				enable
					? "New and edited objects must match the schema."
					: "Objects can be saved without matching a schema.",
			);
			await expect(changes).not.toContainText("validate_schema");
			await expect(changes.locator("pre, details")).toHaveCount(0);
			for (const width of [1280, 390]) {
				await page.setViewportSize({ width, height: 900 });
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= window.innerWidth,
					),
				).toBe(true);
				await changes.screenshot({
					path: testInfo.outputPath(`validation-change-${width}.png`),
				});
			}
		});
	}

	test("checks directly from Validation and reuses the real report in Review", async ({
		page,
	}, testInfo) => {
		const requests = await mockSchema(page);
		await page.goto("/classes/10/schema?step=propose&view=flow&revision=1");
		await expect(
			page.getByRole("heading", { name: "Proposed schema" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Active revision 1" }),
		).toHaveCount(0);
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object"}');
		await page.getByRole("button", { name: "Continue to validation" }).click();
		await page
			.getByRole("checkbox", { name: "Enforce validation on object writes" })
			.check();
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(
			page.getByText("Check complete", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("tab", { name: /2\. Validation/ }),
		).toHaveAttribute("aria-selected", "true");
		expect(
			requests.filter((r) => r.method === "POST").map((r) => r.path),
		).toEqual(["/revisions", "/revisions/2/impact"]);
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("schema-validation-desktop.png"),
			fullPage: true,
		});
		await page
			.getByRole("button", { name: "View findings", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		await page.getByRole("tab", { name: /1\. Schema/ }).click();
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object","required":["name"]}');
		await page.getByRole("tab", { name: /3\. Review & test/ }).click();
		await expect(
			page.getByRole("button", { name: "Continue to review activation" }),
		).toBeDisabled();
		await expect(
			page.getByText("These results are for the saved proposal.", {
				exact: false,
			}),
		).toBeVisible();
		expect(requests.filter((r) => r.path.endsWith("/impact"))).toHaveLength(1);
	});

	test("tests an unenforced schema separately and activates only the selected off policy", async ({
		page,
	}) => {
		const requests = await mockSchema(page);
		await page.goto("/classes/10/schema");
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object"}');
		await page.getByRole("button", { name: "Continue to validation" }).click();
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(page).toHaveURL(/check=30/);
		await expect(
			page.getByText("Check complete", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("checkbox", {
				name: "Enforce validation on object writes",
			}),
		).not.toBeChecked();
		const posts = requests.filter((r) => r.method === "POST");
		expect(posts.map((r) => r.path)).toEqual([
			"/revisions",
			"/revisions/2/impact",
			"/revisions",
			"/revisions/3/impact",
		]);
		expect(posts[0].body).toEqual({
			json_schema: { type: "object" },
			validate_schema: false,
		});
		expect(posts[2].body).toEqual({
			json_schema: { type: "object" },
			validate_schema: true,
		});
		await page
			.getByRole("button", { name: "View findings", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 3" }),
		).toBeVisible();
		await expect(
			page.getByText("Your proposed enforcement remains off.", {
				exact: false,
			}),
		).toBeVisible();
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 3" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Continue to review activation" })
			.click();
		await page
			.getByRole("button", { name: "Activate schema", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Activate schema", exact: true })
			.click();
		await expect(
			page.getByText("Active revision 2", { exact: true }),
		).toBeVisible();
		expect(requests.find((r) => r.path.endsWith("/activate"))).toMatchObject({
			path: "/revisions/2/activate",
			body: {
				expected_active_revision: 1,
				policy: "reject_incompatible",
				impact_task_id: 20,
			},
		});
		await expect(
			page.getByRole("region", { name: "Class schema", exact: true }),
		).toContainText("Enforcement on writesOff");
	});

	test("cancels both checks for an unenforced proposal", async ({ page }) => {
		const requests = await mockSchema(page, { running: true });
		await page.goto("/classes/10/schema");
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill('{"type":"object"}');
		await page.getByRole("button", { name: "Continue to validation" }).click();
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(
			page.getByText("Check running", { exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Cancel work", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Cancel work", exact: true })
			.click();
		await expect(
			page.getByText("Check cancelled", { exact: true }),
		).toBeVisible();
		expect(
			requests.filter((r) => r.method === "DELETE").map((r) => r.path),
		).toEqual(["/tasks/20", "/tasks/30"]);
		await expect(
			page.getByRole("checkbox", {
				name: "Enforce validation on object writes",
			}),
		).not.toBeChecked();
	});

	test("separates current setup from editing on the class page", async ({
		page,
	}, testInfo) => {
		await mockSchema(page);
		await page.goto("/classes/10");
		const status = page.getByRole("region", {
			name: "Class schema",
			exact: true,
		});
		await expect(
			status.getByRole("heading", { name: "Schema & validation" }),
		).toBeVisible();
		await expect(status).toContainText("No schema is configured");
		await expect(status).toContainText(
			"This does not mean existing objects have passed a schema check",
		);
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("class-schema-status-desktop.png"),
			fullPage: true,
		});
		await status
			.getByRole("link", { name: "Change validation settings" })
			.click();
		await expect(
			page.getByRole("tab", { name: /2\. Validation/ }),
		).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("checkbox", {
				name: "Enforce validation on object writes",
			}),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Discard draft" }),
		).toHaveCount(0);
	});

	test("retains edited schema when the server rejects a check before staging", async ({
		page,
	}) => {
		const requests = await mockSchema(page);
		await page.route(`**${schemaPath}/revisions`, (route) =>
			route.request().method() === "POST"
				? route.fulfill({
						status: 400,
						json: { message: "Unsupported schema constraint" },
					})
				: route.fallback(),
		);
		await page.goto("/classes/10/schema");
		const text = '{"type":"object","minProperties":1}';
		await page
			.getByRole("textbox", { name: "Proposed JSON schema", exact: true })
			.fill(text);
		await page.getByRole("button", { name: "Continue to validation" }).click();
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"Unsupported schema constraint",
		);
		await page.getByRole("tab", { name: /1\. Schema/ }).click();
		await expect(
			page.getByRole("textbox", { name: "Proposed JSON schema", exact: true }),
		).toHaveText(text);
		await expect(
			page.getByRole("button", { name: "Discard draft" }),
		).toBeVisible();
		expect(requests.some((r) => r.path.endsWith("/impact"))).toBe(false);
	});

	test("shows pending live validation without claiming a check is running", async ({
		page,
	}) => {
		await mockSchema(page);
		await page.route(`**${schemaPath}`, (route) =>
			route.fulfill({
				json: {
					active: {
						...activeRevision,
						validate_schema: true,
						json_schema: { type: "object" },
					},
					object_epoch: 3,
					counts: { valid: 3, invalid: 2, pending: 5, not_required: 0 },
				},
			}),
		);
		await page.goto("/classes/10");
		const status = page.getByRole("region", {
			name: "Class schema",
			exact: true,
		});
		await expect(status).toContainText("Enforcement on writesOn");
		await expect(status).toContainText("Awaiting validation5");
		await expect(status).toContainText(
			"A check may be running, or revalidation may be needed",
		);
		await expect(
			status.getByRole("button", { name: "Revalidate active schema" }),
		).toBeEnabled();
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		const accessibility = await new AxeBuilder({ page })
			.include("main")
			.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
			.analyze();
		expect(accessibility.violations).toEqual([]);
	});

	test("requires explicit activation and follows its revalidation and rebuild", async ({
		page,
	}) => {
		const requests = await mockSchema(page);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await page
			.getByRole("button", { name: "Continue to review activation" })
			.click();
		await expect(
			page.getByRole("tab", { name: /4\. Activate/ }),
		).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("button", { name: "Activate schema & enable enforcement" })
			.click();
		await expect(page.getByRole("alertdialog")).toBeVisible();
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
		await page
			.getByRole("alertdialog")
			.getByRole("button", {
				name: "Activate schema & enable enforcement",
				exact: true,
			})
			.click();
		await expect(
			page.getByText("Active revision 2", { exact: true }),
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
		const requests = await mockSchema(page, { incompatible: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		await expect(
			page
				.getByRole("banner")
				.getByRole("heading", { name: "Classes", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Edit schema · Devices", exact: true }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Open account menu for admin" })
			.click();
		await page.getByRole("button", { name: "Light", exact: true }).click();
		await page.keyboard.press("Escape");
		await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
		await expect(
			page.getByRole("button", { name: "Continue to review activation" }),
		).toBeDisabled();
		await expect(
			page.getByRole("tab", { name: /4\. Activate/ }),
		).toBeDisabled();
		await expect(
			page.getByText(
				"Objects fail the proposed schema. Revise the proposal or repair the objects, then analyze again.",
				{ exact: true },
			),
		).toBeVisible();
		await expect(
			page.getByText("Missing required “hostname”", { exact: true }),
		).toBeVisible();
		const downloadPromise = page.waitForEvent("download");
		await page
			.getByRole("button", { name: "Download report (JSON)", exact: true })
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe(
			"schema-impact-class-10-revision-2-task-20-complete.json",
		);
		const stream = await download.createReadStream();
		if (!stream)
			throw new Error("The report download did not provide a stream.");
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		const exported = JSON.parse(
			Buffer.concat(chunks).toString("utf8"),
		) as SchemaWorkResponse;
		expect(exported).toEqual({
			...report(),
			readiness: "incompatible",
			valid: 0,
			invalid: 1,
			impact: {
				...report().impact,
				counts: {
					...report().impact?.counts,
					newly_invalid: 1,
					newly_required_valid: 0,
				},
				failures: [
					{
						reason: { keyword: "required", missing_property: "hostname" },
						objects: 1,
						samples: [100],
					},
				],
			},
		});
		await page
			.getByText("Override compatibility checks (administrator)", {
				exact: true,
			})
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
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect(
			page
				.getByRole("banner")
				.getByRole("heading", { name: "Classes", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Edit schema · Devices", exact: true }),
		).toBeVisible();
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
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
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
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("schema-impact-mobile-dark.png"),
			fullPage: true,
		});
	});

	test("shows saved diagnostics with precise locations, omissions and legacy findings", async ({
		page,
	}, testInfo) => {
		const work = diagnosticReport();
		await mockSchema(page, { work });
		await mockRepairReports(page);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const diagnostics = page.getByRole("region", {
			name: "Object diagnostics",
		});
		await diagnostics.getByLabel("View findings").selectOption("objects");
		await diagnostics
			.getByText("Object #100 · 4 recorded issues", { exact: true })
			.click();
		await expect(
			diagnostics.getByText("Required property hostname is missing.", {
				exact: true,
			}),
		).toBeVisible();
		await expect(
			diagnostics.getByText("/interfaces/3/address", { exact: true }),
		).toBeVisible();
		await expect(
			diagnostics.getByText("Root of object data", { exact: true }),
		).toBeVisible();
		await expect(diagnostics.getByText("null", { exact: true })).toBeVisible();
		await expect(diagnostics.getByText("Omitted", { exact: true })).toHaveCount(
			2,
		);
		await expect(
			diagnostics.getByText(/Alternative branch explanation/),
		).toBeVisible();
		await expect(
			diagnostics.getByText(/More issues exist than the server retained/),
		).toBeVisible();
		await expect(
			diagnostics.getByText(/Object location redacted or too long/),
		).toBeVisible();
		await expect(diagnostics.getByText(/Reported text: <img/)).toBeVisible();
		await expect(diagnostics.getByRole("img")).toHaveCount(0);
		await expect(
			diagnostics.getByRole("link", { name: "Open object #100", exact: true }),
		).toHaveAttribute("href", "/objects/10/100");
		expect(await downloadReport(page)).toEqual(work);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			)
			.toBe(true);
		expect(
			(await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
				["serious", "critical"].includes(item.impact ?? ""),
			),
		).toEqual([]);
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("schema-diagnostics-mobile.png"),
			fullPage: true,
		});
		await diagnostics.getByRole("button", { name: "Next page" }).click();
		await expect(
			diagnostics.getByText("Objects 11–12 of 12", { exact: true }),
		).toBeVisible();
		await diagnostics
			.getByText("Object #111 · First failure only", { exact: true })
			.click();
		await expect(
			diagnostics
				.getByText(/This older finding retained only its first failure/)
				.filter({ visible: true }),
		).toBeVisible();
	});

	test("consolidates repeated errors and paginates all affected objects without changing JSON", async ({
		page,
	}) => {
		const work = diagnosticReport();
		const findings = work.impact?.findings;
		const snapshot = findings?.[0].snapshot;
		if (!findings || !snapshot) throw new Error("Diagnostics fixture required");
		for (const finding of findings)
			finding.snapshot = {
				...structuredClone(snapshot),
				object_revision: finding.object_id,
			};
		await mockSchema(page, { work });
		await mockRepairReports(page);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const diagnostics = page.getByRole("region", {
			name: "Object diagnostics",
		});
		await expect(diagnostics.getByLabel("View findings")).toHaveValue("errors");
		await expect(
			diagnostics.getByText(
				"4 distinct errors across 12 objects · Errors 1–4",
				{ exact: true },
			),
		).toBeVisible();
		const error = diagnostics.locator("details").filter({
			has: page
				.locator("summary")
				.filter({ hasText: "Required property hostname is missing." }),
		});
		await error.locator("summary").click();
		await expect(
			error.getByText("Required property hostname is missing.", {
				exact: true,
			}),
		).toHaveCount(1);
		await expect(error.getByRole("link", { name: /^Open object/ })).toHaveCount(
			10,
		);
		await expect(
			error.getByText(
				/More issues exist than the server retained for this object/,
			),
		).toHaveCount(10);
		await error.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(
			error.getByRole("link", { name: "Open object #111", exact: true }),
		).toHaveAttribute("href", "/objects/10/111");
		await expect(error.getByText(/Object revision 111/)).toBeVisible();
		expect(await downloadReport(page)).toEqual(work);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			)
			.toBe(true);
		expect(
			(await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
				["serious", "critical"].includes(item.impact ?? ""),
			),
		).toEqual([]);
	});

	test("generates a chosen HTML layout once and reuses the saved report for viewing and download", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { work: diagnosticReport() });
		const reports = await mockRepairReports(page);
		await page.route(
			"**/_hubuum-bff/hubuum/api/v1/export-templates?*",
			(route) =>
				route.fulfill({
					json: [
						{
							id: 7,
							name: "Repair layout",
							kind: "fragment",
							content_type: "text/html",
							template: "{{ report_content }}",
						},
					],
				}),
		);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const actions = page.getByRole("region", { name: "HTML repair report" });
		await actions.getByText("Report layout", { exact: true }).click();
		await actions
			.getByLabel("Layout for the next generation")
			.selectOption("7");
		const popupPromise = page.waitForEvent("popup");
		await actions
			.getByRole("button", { name: "View HTML report", exact: true })
			.click();
		const preview = await popupPromise;
		await expect(
			preview.getByRole("heading", { name: "Schema repair report" }),
		).toBeVisible();
		await expect(preview.locator("body")).not.toHaveAttribute(
			"data-script-executed",
			"yes",
		);
		expect(reports.generated).toEqual([
			{
				object_url_template: `${new URL(page.url()).origin}/objects/10/{object_id}`,
				template_id: 7,
			},
		]);
		const objectPromise = preview.waitForEvent("popup");
		await preview
			.getByRole("link", { name: "Object #100", exact: true })
			.click();
		const objectPage = await objectPromise;
		await expect(objectPage).toHaveURL(/\/objects\/10\/100$/);
		await objectPage.close();
		await preview.close();
		await page.reload();
		await expect(
			actions.getByRole("link", { name: "View HTML report", exact: true }),
		).toBeVisible();
		const downloadPromise = page.waitForEvent("download");
		await actions
			.getByRole("link", { name: "Download HTML report", exact: true })
			.click();
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toBe("schema-repair-20.html");
		const stream = await download.createReadStream();
		if (!stream) throw new Error("Missing HTML download stream");
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		expect(Buffer.concat(chunks).toString("utf8")).toBe(reports.html);
		expect(reports.generated).toHaveLength(1);
		expect(
			requests.some(
				(item) => item.method === "POST" && /impact|activate/.test(item.path),
			),
		).toBe(false);
	});

	test("creates a downloadable HTML report directly with the default layout", async ({
		page,
	}) => {
		await mockSchema(page, { work: diagnosticReport() });
		const reports = await mockRepairReports(page);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const downloadPromise = page.waitForEvent("download");
		await page
			.getByRole("button", { name: "Download HTML report", exact: true })
			.click();
		expect((await downloadPromise).suggestedFilename()).toBe(
			"schema-repair-20.html",
		);
		expect(reports.generated).toEqual([
			{
				object_url_template: `${new URL(page.url()).origin}/objects/10/{object_id}`,
				template_id: null,
			},
		]);
	});

	test("preserves saved HTML when report regeneration exceeds an output limit", async ({
		page,
	}) => {
		await mockSchema(page, { work: diagnosticReport() });
		const reports = await mockRepairReports(page, true);
		reports.failGeneration(413);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const actions = page.getByRole("region", { name: "HTML repair report" });
		await actions.getByRole("button", { name: "Refresh HTML report" }).click();
		await expect(actions.getByRole("alert")).toContainText(
			"Report output limit exceeded",
		);
		await expect(actions.getByRole("alert")).toContainText(
			"The previous HTML report remains available",
		);
		await expect(
			actions.getByRole("link", { name: "Download HTML report" }),
		).toBeVisible();
	});

	test("does not treat denied HTML report access as an unavailable legacy feature", async ({
		page,
	}) => {
		await mockSchema(page, { work: diagnosticReport() });
		await page.route(`**${schemaPath}/tasks/20/report*`, (route) =>
			route.fulfill({
				status: 403,
				json: { message: "Administrator access required" },
			}),
		);
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const actions = page.getByRole("region", { name: "HTML repair report" });
		await expect(actions.getByRole("alert")).toContainText(
			"Administrator access required",
		);
		await expect(
			actions.getByRole("button", { name: "View HTML report" }),
		).toBeDisabled();
	});

	test("pages complete failure lists and downloads every ID", async ({
		page,
	}, testInfo) => {
		const work = largeFailureReport();
		await mockSchema(page, { work });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const details = page.getByRole("region", {
			name: "Failure details",
			exact: true,
		});
		await expect(
			details.getByText("Groups 1–10 of 25", { exact: true }),
		).toBeVisible();
		await expect(details.getByRole("row")).toHaveCount(11);
		await expect(details.getByRole("link", { name: /^Object #/ })).toHaveCount(
			73,
		);
		await expect(page.getByText(/This older report omitted/)).toHaveCount(0);

		const firstGroup = page.getByRole("region", {
			name: "Object IDs for failure group 1",
			exact: true,
		});
		await expect(
			firstGroup.getByText("IDs 1–10 of 8192 available", { exact: true }),
		).toBeVisible();
		await firstGroup.getByRole("button", { name: "Next page" }).click();
		await expect(
			firstGroup.getByRole("link", { name: "Object #1010", exact: true }),
		).toHaveAttribute("href", "/objects/10/1010");
		await expect(
			firstGroup.getByRole("link", { name: "Object #1000", exact: true }),
		).toHaveCount(0);
		await firstGroup.getByRole("button", { name: "Previous page" }).click();
		await expect(
			firstGroup.getByRole("link", { name: "Object #1000", exact: true }),
		).toBeVisible();
		await firstGroup.getByRole("button", { name: "Next page" }).click();
		await firstGroup
			.getByRole("button", { name: "First", exact: true })
			.click();
		await expect(
			firstGroup.getByText("IDs 1–10 of 8192 available", { exact: true }),
		).toBeVisible();

		const pages = page.getByRole("navigation", { name: "Failure group pages" });
		await pages.getByRole("button", { name: "Next page" }).click();
		await expect(
			details.getByText("Groups 11–20 of 25", { exact: true }),
		).toBeVisible();
		await pages.getByRole("button", { name: "Next page" }).click();
		await expect(
			details.getByText("Groups 21–25 of 25", { exact: true }),
		).toBeVisible();
		await expect(details.getByRole("row")).toHaveCount(6);
		await expect(
			details.getByText("Missing required “field_25”", { exact: true }),
		).toBeVisible();
		await expect(pages.getByRole("button", { name: "Next page" })).toHaveCount(
			0,
		);
		expect(await downloadReport(page)).toEqual(work);
		await pages.getByRole("button", { name: "Previous page" }).click();
		await expect(
			details.getByText("Groups 11–20 of 25", { exact: true }),
		).toBeVisible();
		await pages.getByRole("button", { name: "First", exact: true }).click();
		await expect(
			details.getByText("Groups 1–10 of 25", { exact: true }),
		).toBeVisible();
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
		await page.evaluate(() => {
			window.scrollTo({ top: 0, behavior: "instant" });
			if (document.activeElement instanceof HTMLElement)
				document.activeElement.blur();
		});
		await page.screenshot({
			path: testInfo.outputPath("schema-full-report-mobile.png"),
			fullPage: true,
		});
	});

	for (const status of ["complete", "cancelled"] as const) {
		test(`identifies sampled legacy ${status} reports and preserves their data`, async ({
			page,
		}) => {
			const work = largeFailureReport();
			if (!work.impact) throw new Error("Impact fixture required");
			work.status = status;
			work.readiness = status === "complete" ? "incompatible" : "inconclusive";
			work.impact.failures = work.impact.failures.slice(0, 2);
			work.impact.failures[0].objects = 10;
			work.impact.failures[0].samples = [1000, 1001, 1002, 1003, 1004];
			work.impact.ungrouped_failures = 3;
			work.examined = 20;
			work.invalid = 20;
			work.invalid_samples = [1000, 1001, 1002, 1003, 1004];
			work.impact.counts.newly_invalid = 20;
			await mockSchema(page, { work });
			await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
			await expect(
				page.getByText(/This older report omitted 8 object IDs/),
			).toBeVisible();
			await expect(
				page.getByText(/Analyze again on an updated server for complete lists/),
			).toBeVisible();
			expect(await downloadReport(page, status !== "complete")).toEqual(work);
		});
	}

	test("keeps complete committed lists in a running partial download", async ({
		page,
	}) => {
		const work = largeFailureReport();
		work.status = "running";
		work.readiness = "inconclusive";
		work.end_epoch = null;
		await mockSchema(page, { work });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await expect(
			page.getByRole("heading", { name: "Impact analysis · Revision 2" }),
		).toBeVisible();
		await expect(page.getByText(/This older report omitted/)).toHaveCount(0);
		expect(await downloadReport(page, true)).toEqual(work);
	});

	for (const state of [
		"missing",
		"running",
		"failed",
		"cancelled",
		"superseded",
		"stale",
	] as const) {
		test(`blocks progression while analysis is ${state}`, async ({ page }) => {
			const requests = await mockSchema(page, {
				status: ["running", "failed", "cancelled", "superseded"].includes(state)
					? (state as SchemaWorkResponse["status"])
					: undefined,
				stale: state === "stale",
			});
			await page.goto(
				`/classes/10/schema?revision=2&step=impact${state === "missing" ? "" : "&task=20"}`,
			);
			await expect(
				page.getByRole("button", { name: "Continue to review activation" }),
			).toBeDisabled();
			await expect(
				page.getByRole("tab", { name: /4\. Activate/ }),
			).toBeDisabled();
			await expect(
				page.getByRole("button", { name: "Revise proposal", exact: true }),
			).toBeEnabled();
			if (state === "running") {
				await expect(
					page.getByRole("button", {
						name: "Download partial report (JSON)",
						exact: true,
					}),
				).toBeVisible();
				await expect(
					page.getByRole("button", {
						name: "Download report (JSON)",
						exact: true,
					}),
				).toHaveCount(0);
				await expect(
					page.getByRole("button", { name: "Check in progress…" }),
				).toBeDisabled();
				await expect(
					page.getByText(
						"Wait for the impact analysis to finish before activation.",
					),
				).toBeVisible();
			} else {
				await expect(
					page.getByRole("button", {
						name:
							state === "missing" ? "Check existing objects" : "Check again",
						exact: true,
					}),
				).toBeEnabled();
			}
			expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
				false,
			);
		});
	}

	test("retains a saved proposal when starting analysis fails", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { analysisError: true });
		await page.goto("/classes/10/schema?revision=2&step=review");
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"Analysis unavailable",
		);
		await expect(page).toHaveURL(/revision=2&step=review/);
		await expect(
			page.getByRole("button", { name: "Check existing objects", exact: true }),
		).toBeEnabled();
		await expect(
			page.getByRole("tab", { name: /4\. Activate/ }),
		).toBeDisabled();
		expect(
			requests
				.filter((item) => item.method === "POST")
				.map((item) => item.path),
		).toEqual(["/revisions/2/impact"]);
	});

	test("enables progression when the running analysis becomes compatible", async ({
		page,
	}) => {
		await mockSchema(page, { running: true });
		let complete = false;
		await page.route(`**${schemaPath}/tasks/20`, (route) =>
			route.fulfill({
				json: {
					...report(),
					status: complete ? "complete" : "running",
					readiness: complete ? "compatible" : "inconclusive",
				},
			}),
		);
		await page.goto("/classes/10/schema?revision=2&step=review");
		await page
			.getByRole("button", { name: "Check existing objects", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Check in progress…" }),
		).toBeDisabled();
		await expect(
			page.getByRole("tab", { name: /4\. Activate/ }),
		).toBeDisabled();
		complete = true;
		await expect(
			page.getByRole("button", { name: "Continue to review activation" }),
		).toBeEnabled();
		await expect(page.getByRole("tab", { name: /4\. Activate/ })).toBeEnabled();
	});

	test("requires a separate confirmation to override incompatible analysis", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { incompatible: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		const override = page.getByRole("button", {
			name: "Activate with pending validation…",
			exact: true,
		});
		await expect(override).toBeHidden();
		await page
			.getByText("Override compatibility checks (administrator)", {
				exact: true,
			})
			.click();
		await override.click();
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
		await page
			.getByRole("alertdialog")
			.getByRole("button", {
				name: "Activate with pending validation",
				exact: true,
			})
			.click();
		await expect(
			page.getByText("Active revision 2", { exact: true }),
		).toBeVisible();
		expect(
			requests.find((item) => item.path.endsWith("/activate"))?.body,
		).toEqual({ expected_active_revision: 1, policy: "allow_pending" });
	});

	test("can revise or rerun an incompatible proposal without advancing", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { incompatible: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await page
			.getByRole("button", { name: "Check again", exact: true })
			.click();
		await expect
			.poll(() => requests.filter((item) => item.path.endsWith("/impact")))
			.toHaveLength(1);
		await expect(
			page.getByRole("button", { name: "Continue to review activation" }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: "Revise proposal", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Proposed schema" }),
		).toBeVisible();
		await page.getByRole("tab", { name: /2\. Validation/ }).click();
		await expect(
			page.getByRole("checkbox", {
				name: "Enforce validation on object writes",
			}),
		).toBeChecked();
		await expect(page).toHaveURL(/task=20/);
		expect(requests.some((item) => item.path.endsWith("/activate"))).toBe(
			false,
		);
	});

	test("keeps direct activation links blocked when the report is incompatible", async ({
		page,
	}) => {
		await mockSchema(page, { incompatible: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=activate");
		await expect(
			page.getByRole("button", {
				name: "Activate schema & enable enforcement",
			}),
		).toBeDisabled();
		await page.getByRole("button", { name: "Return to review & test" }).click();
		await expect(
			page.getByRole("tab", { name: /3\. Review & test/ }),
		).toHaveAttribute("aria-selected", "true");
	});

	test("allows an empty class to proceed without an analysis task", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { empty: true });
		await page.goto("/classes/10/schema?revision=2&step=impact");
		await page
			.getByRole("button", { name: "Continue to review activation" })
			.click();
		await expect(
			page.getByRole("button", {
				name: "Activate schema & enable enforcement",
			}),
		).toBeEnabled();
		expect(requests.some((item) => item.path.endsWith("/impact"))).toBe(false);
	});

	test("retains the proposal after a concurrent activation conflict", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { conflict: true });
		await page.goto("/classes/10/schema?revision=2&task=20&step=activate");
		await page
			.getByRole("button", { name: "Activate schema & enable enforcement" })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", {
				name: "Activate schema & enable enforcement",
				exact: true,
			})
			.click();
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"The proposal is retained",
		);
		await expect(page).toHaveURL(/revision=2/);
		expect(
			requests.filter((item) => item.path.endsWith("/activate")),
		).toHaveLength(1);
	});

	for (const status of ["retired", "abandoned"] as const) {
		test(`saves an unchanged ${status} policy as a new proposal without administrator access`, async ({
			page,
		}) => {
			const historical = { ...proposedRevision, status };
			const requests = await mockSchema(page, {
				admin: false,
				active: { ...activeRevision, revision: 3 },
				proposed: historical,
				nextStagedRevision: 4,
			});
			await page.goto("/classes/10/schema?revision=2&view=revision");
			await expect(
				page.getByRole("heading", { name: `Revision 2 · ${status}` }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "Edit as a new proposal" })
				.click();
			await page.getByRole("tab", { name: /3\. Review & test/ }).click();
			await expect(
				page.getByText("share its revision link", { exact: false }),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "Check existing objects" }),
			).toHaveCount(0);
			await page
				.getByRole("button", { name: "Save revision", exact: true })
				.click();
			await expect(page).toHaveURL(/revision=4/);
			await expect(
				page.getByText("Saved proposal · Revision 4", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByRole("link", { name: "Link to this revision" }),
			).toHaveAttribute("href", /revision=4/);
			await expect(
				page.getByRole("button", { name: "Save revision", exact: true }),
			).toHaveCount(0);
			expect(requests.filter((item) => item.method === "POST")).toEqual([
				{
					method: "POST",
					path: "/revisions",
					body: {
						json_schema: historical.json_schema,
						validate_schema: historical.validate_schema,
					},
				},
			]);
		});
	}

	test("restricts reports and provides an administrator handoff", async ({
		page,
	}) => {
		const requests = await mockSchema(page, { admin: false });
		await page.goto("/classes/10/schema?revision=2&task=20&step=impact");
		await expect(
			page.getByText("share its revision link", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Check existing objects", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByText("Override compatibility checks (administrator)", {
				exact: true,
			}),
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
		await page.getByRole("tab", { name: /1\. Schema/ }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(
			page.getByRole("tab", { name: /2\. Validation/ }),
		).toBeFocused();
		await page.goto("/classes/10");
		await page
			.getByRole("link", { name: "Object compliance", exact: true })
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
		await expect(page.getByRole("link", { name: "Edit schema" })).toBeVisible();
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
		await expect(page.getByRole("link", { name: "Edit schema" })).toHaveCount(
			0,
		);
	});
});
