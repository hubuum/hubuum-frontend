import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { TaskResponse } from "../../src/lib/api/generated/models";

const prefix = "/_hubuum-bff/hubuum/api/v1";
const timestamp = "2026-09-15T12:00:00Z";
function task(overrides: Partial<TaskResponse> = {}): TaskResponse {
	return {
		id: 700,
		kind: "export",
		status: "queued",
		created_at: timestamp,
		progress: {
			total_items: 10,
			processed_items: 0,
			success_items: 0,
			failed_items: 0,
		},
		links: { task: "/api/v1/tasks/700", events: "/api/v1/tasks/700/events" },
		unattempted_items: 10,
		...overrides,
	};
}

async function openTask(page: Page, current: () => TaskResponse) {
	await page.route(`**${prefix}/tasks/700`, (route) =>
		route.fulfill({ json: current() }),
	);
	await page.route(`**${prefix}/tasks/700/events?*`, (route) =>
		route.fulfill({ json: [] }),
	);
	await page.goto("/tasks/700");
	await expect(page.getByRole("heading", { name: /task #700/i })).toBeVisible();
}

test.describe("task discovery", () => {
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

	test("searches on the server and preserves filters through pagination, reload and back", async ({
		page,
	}) => {
		const requests: URLSearchParams[] = [];
		await page.route(`**${prefix}/tasks?*`, (route) => {
			const params = new URL(route.request().url()).searchParams;
			requests.push(params);
			return route.fulfill({
				json: [
					task({
						id: params.has("cursor") ? 699 : 700,
						status: "succeeded",
						summary: "Discovery result",
					}),
				],
				headers: params.has("cursor") ? {} : { "x-next-cursor": "older-tasks" },
			});
		});
		await page.goto("/tasks");
		const form = page.getByRole("form", { name: "Task search" });
		await expect(
			page.getByRole("link", { name: "#700", exact: true }),
		).toBeVisible();
		await form.getByLabel("Task scope").selectOption("all");
		await form.getByText("Lifecycle", { exact: true }).click();
		await form
			.getByRole("group", { name: "Task kinds", exact: true })
			.getByLabel("export", { exact: true })
			.check();
		await form
			.getByRole("group", { name: "Task statuses", exact: true })
			.getByLabel("succeeded", { exact: true })
			.check();
		await form
			.getByLabel("Completed tasks", { exact: true })
			.selectOption("true");
		await form.getByText("Export and output", { exact: true }).click();
		await form
			.getByLabel("Export has warnings", { exact: true })
			.selectOption("false");
		await form
			.getByLabel("Export truncated", { exact: true })
			.selectOption("false");
		await form
			.getByLabel("Output state (exports and backups)")
			.selectOption("expired");
		await form.getByRole("button", { name: "Apply task filters" }).click();
		await expect
			.poll(() =>
				requests.some(
					(params) =>
						params.get("output_state") === "expired" &&
						params.get("export_truncated") === "false" &&
						!params.has("submitted_by"),
				),
			)
			.toBe(true);
		await page.getByRole("button", { name: "Next page", exact: true }).click();
		await expect(
			page.getByRole("link", { name: "#699", exact: true }),
		).toBeVisible();
		const second = requests.find(
			(params) => params.get("cursor") === "older-tasks",
		);
		expect(second?.get("kind")).toBe("export");
		expect(second?.get("status")).toBe("succeeded");
		expect(second?.get("export_has_warnings")).toBe("false");
		expect(second?.get("include_total")).toBe("false");
		await page.reload();
		await expect(
			form.getByLabel("Export truncated", { exact: true }),
		).toHaveValue("false");
		await page
			.getByRole("button", { name: "Previous page", exact: true })
			.click();
		await expect(
			page.getByRole("link", { name: "#700", exact: true }),
		).toBeVisible();
		await form
			.getByLabel("Export truncated", { exact: true })
			.selectOption("true");
		await form.getByRole("button", { name: "Apply task filters" }).click();
		await expect(page).toHaveURL(/export_truncated=true/);
		expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
		await page.goBack();
		await expect(
			form.getByLabel("Export truncated", { exact: true }),
		).toHaveValue("false");
		await form.getByRole("button", { name: "Clear task filters" }).click();
		await expect(form.getByLabel("Task scope")).toHaveValue("mine");
		await expect
			.poll(() =>
				requests.some(
					(params) => params.has("submitted_by") && !params.has("kind"),
				),
			)
			.toBe(true);
	});

	test("validates paired fields and remains accessible on mobile", async ({
		page,
	}) => {
		await page.route(`**${prefix}/tasks?*`, (route) =>
			route.fulfill({ json: [] }),
		);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/tasks?scope=all&relation_id=7");
		const form = page.getByRole("form", { name: "Task search" });
		await expect(form).toHaveAttribute("aria-busy", "false");
		await expect(form.getByRole("alert")).toContainText("required together");
		await form
			.getByLabel("Relation type", { exact: true })
			.selectOption("object_relation");
		await form.getByRole("button", { name: "Apply task filters" }).click();
		await expect(form.getByRole("alert")).toHaveCount(0);
		await expect(page.getByText("No tasks match these filters.")).toBeVisible();
		for (const label of [
			"Lifecycle",
			"Time ranges",
			"Export and output",
			"Import",
			"Backup and remote calls",
		])
			await form.getByText(label, { exact: true }).click();
		expect(
			(
				await new AxeBuilder({ page })
					.include('form[aria-label="Task search"]')
					.analyze()
			).violations,
		).toEqual([]);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	});

	test("displays server rejection of incompatible filters", async ({
		page,
	}) => {
		await page.route(`**${prefix}/tasks?*`, (route) =>
			route.fulfill({
				status: 400,
				json: { message: "Filters conflict with task kinds" },
			}),
		);
		await page.goto("/tasks?scope=all&kind=import&class_id=1");
		await expect(
			page.getByText(/Failed to load recent tasks.*Filters conflict/),
		).toBeVisible({ timeout: 15000 });
	});

	const metadataCases: {
		kind: TaskResponse["kind"];
		details: TaskResponse["details"];
		label: string;
		value: string;
	}[] = [
		{
			kind: "import",
			details: {
				import: {
					results_url: "/api/v1/imports/700/results",
					retained: {
						dry_run: false,
						atomicity: "best_effort",
						has_failed_items: null,
					},
				},
			},
			label: "Dry run",
			value: "No",
		},
		{
			kind: "export",
			details: {
				export: {
					output_url: "/api/v1/exports/700/output",
					output_available: false,
					output_expired: true,
					retained: {
						output_state: "expired",
						warning_count: 0,
						truncated: false,
					},
				},
			},
			label: "Retained warning count",
			value: "0",
		},
		{
			kind: "backup",
			details: {
				backup: {
					output_url: "/api/v1/backups/700/output",
					output_available: true,
					output_expired: false,
					retained: { output_state: "available", include_history: false },
				},
			},
			label: "Includes history",
			value: "No",
		},
		{
			kind: "reindex",
			details: { reindex: { class_id: 42, computation_revision: 0 } },
			label: "Computation revision",
			value: "0",
		},
		{
			kind: "schema_validation",
			details: {
				schema_validation: {
					class_id: 42,
					schema_revision: 2,
					work_kind: "impact",
					work_status: "superseded",
					results_url: "/api/v1/classes/42/schema/tasks/700/report",
				},
			},
			label: "Schema work status",
			value: "superseded",
		},
		{
			kind: "remote_call",
			details: {
				remote_call: {
					remote_target_id: 5,
					target: { type: "object", object_id: 8, class_id: 42 },
				},
			},
			label: "Recorded target",
			value: "Object #8 (class #42)",
		},
	];
	for (const entry of metadataCases)
		test(`shows retained ${entry.kind} details`, async ({ page }) => {
			const current = task({ ...entry, status: "succeeded" });
			await page.route(`**${prefix}/imports/700`, (route) =>
				route.fulfill({ json: current }),
			);
			await page.route(`**${prefix}/imports/700/results?*`, (route) =>
				route.fulfill({ json: [] }),
			);
			await openTask(page, () => current);
			const details = page.getByRole("article", {
				name: "Recorded task details",
			});
			await expect(
				details
					.getByText(entry.label, { exact: true })
					.locator("..")
					.getByRole("definition"),
			).toHaveText(entry.value);
			if (entry.kind === "import")
				await expect(
					details
						.getByText("Has failed items", { exact: true })
						.locator("..")
						.getByRole("definition"),
				).toHaveText("Unknown");
			if (entry.kind === "backup")
				await expect(
					page.getByRole("link", { name: "Download backup" }),
				).toHaveAttribute("href", `${prefix}/backups/700/output`);
			if (entry.kind === "export")
				await expect(
					page.getByRole("link", { name: "Open result in new tab" }),
				).toHaveCount(0);
			if (entry.kind === "schema_validation")
				await expect(
					details.getByRole("link", { name: "Open schema report (JSON)" }),
				).toHaveAttribute(
					"href",
					`${prefix}/classes/42/schema/tasks/700/report`,
				);
			expect(
				(
					await new AxeBuilder({ page })
						.include('[aria-labelledby="task-recorded-details"]')
						.analyze()
				).violations,
			).toEqual([]);
		});

	test("does not show output or resource links when details are unavailable", async ({
		page,
	}) => {
		await openTask(page, () => task({ status: "succeeded", details: null }));
		const details = page.getByRole("article", {
			name: "Recorded task details",
		});
		await expect(details).toContainText("Task metadata is unavailable");
		await expect(details.getByRole("link")).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Open result in new tab" }),
		).toHaveCount(0);
	});
});
