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

test.describe("task cancellation", () => {
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

	test("withdraws queued work with an accessible confirmation and status guard", async ({
		page,
	}) => {
		let current = task();
		await page.route(`**${prefix}/tasks/700/cancel`, async (route) => {
			expect(route.request().postDataJSON()).toEqual({
				reason: "Wrong collection",
				expected_status: "queued",
			});
			current = {
				...current,
				status: "cancelled",
				cancel_requested_at: timestamp,
				cancel_reason: "Wrong collection",
				cancel_requested_by: 1,
				finished_at: timestamp,
				terminal_reason: "cancel_requested",
			};
			await route.fulfill({ json: current });
		});
		await openTask(page, () => current);
		await page
			.getByLabel("Cancellation reason (optional)")
			.fill("Wrong collection");
		await page
			.getByRole("button", { name: "Cancel task", exact: true })
			.click();
		const dialog = page.getByRole("alertdialog", { name: "Cancel task #700?" });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByRole("button", { name: "Keep task" }),
		).toBeFocused();
		expect(
			(await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze())
				.violations,
		).toEqual([]);
		await dialog.getByRole("button", { name: "Request cancellation" }).click();
		await expect(page.getByText("cancelled", { exact: true })).toBeVisible();
		await expect(
			page.getByText("Wrong collection", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cancel task", exact: true }),
		).toHaveCount(0);
	});

	test("polls an accepted cancellation through cleanup and refreshes final import receipts", async ({
		page,
	}) => {
		const original = task({
			kind: "import",
			status: "running",
			started_at: timestamp,
		});
		let current = original;
		let finished = false;
		await page.route(`**${prefix}/imports/700`, (route) =>
			route.fulfill({ json: original }),
		);
		await page.route(`**${prefix}/imports/700/results?*`, (route) =>
			route.fulfill({
				json: finished
					? [
							{
								id: 1,
								task_id: 700,
								created_at: timestamp,
								entity_kind: "objects",
								action: "skip",
								outcome: "unattempted",
								details: { count: 7 },
							},
						]
					: [],
			}),
		);
		await page.route(`**${prefix}/tasks/700/cancel`, (route) => {
			expect(route.request().postDataJSON()).toEqual({});
			current = {
				...current,
				cancel_requested_at: timestamp,
				cancel_reason: null,
			};
			return route.fulfill({ status: 202, json: current });
		});
		await openTask(page, () => current);
		await page
			.getByRole("button", { name: "Cancel task", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Request cancellation", exact: true })
			.click();
		await expect(
			page
				.getByRole("status")
				.filter({ hasText: "Waiting for executor cleanup" }),
		).toBeVisible();
		await expect(page.getByText("running", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cancel task", exact: true }),
		).toHaveCount(0);
		finished = true;
		current = {
			...current,
			status: "cancelled",
			finished_at: timestamp,
			unattempted_items: 7,
			terminal_reason: "cancel_requested",
		};
		await expect(page.getByText("cancelled", { exact: true })).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			page.getByRole("cell", { name: "unattempted", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("cell", { name: "7", exact: true }),
		).toBeVisible();
	});

	test("refreshes a queued withdrawal conflict without silently cancelling running work", async ({
		page,
	}) => {
		let current = task();
		let requests = 0;
		await page.route(`**${prefix}/tasks/700/cancel`, (route) => {
			requests += 1;
			current = { ...current, status: "running" };
			return route.fulfill({
				status: 409,
				json: { message: "Task is no longer queued" },
			});
		});
		await openTask(page, () => current);
		await page
			.getByRole("button", { name: "Cancel task", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Request cancellation", exact: true })
			.click();
		await expect(
			page.getByRole("alert").filter({ hasText: "Task is no longer queued" }),
		).toBeVisible();
		await expect(page.getByText("running", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cancel task", exact: true }),
		).toBeEnabled();
		expect(requests).toBe(1);
	});

	test("keeps authorization errors visible without claiming cancellation", async ({
		page,
	}) => {
		await page.route(`**${prefix}/tasks/700/cancel`, (route) =>
			route.fulfill({
				status: 403,
				json: { message: "CancelTask permission required" },
			}),
		);
		await openTask(page, () => task());
		await page
			.getByRole("button", { name: "Cancel task", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Request cancellation", exact: true })
			.click();
		await expect(
			page
				.getByRole("alert")
				.filter({ hasText: "CancelTask permission required" }),
		).toBeVisible();
		await expect(page.getByText("queued", { exact: true })).toBeVisible();
	});

	test("shows deadline and remote side effects on mobile without offering a terminal cancellation", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await openTask(page, () =>
			task({
				kind: "remote_call",
				status: "cancelled",
				terminal_reason: "deadline_exceeded",
				execution_deadline_at: timestamp,
				remote_side_effect_state: "possibly_sent",
			}),
		);
		await expect(
			page.getByText("Execution deadline exceeded", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Possibly sent; external effects may have occurred"),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Cancel task", exact: true }),
		).toHaveCount(0);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
	});
});
