import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const tokenPath = "/_hubuum-bff/hubuum/api/v1/iam/principals/42/tokens";
const confirmationPath = "/_hubuum-bff/credential-mutations";

test.describe("optional credential confirmation", () => {
	test.beforeEach(async ({ page }) => {
		await page.route("**/_hubuum-bff/auth/providers", (route) =>
			route.fulfill({ status: 404, json: {} }),
		);
		await page.goto("/login");
		await expect(
			page.getByRole("form", { name: "Login form" }),
		).not.toHaveAttribute("data-provider-discovery", "loading");
	});

	test("older servers complete without a password prompt or approval request", async ({
		page,
	}) => {
		let confirmations = 0;
		await page.route(`**${confirmationPath}`, (route) => {
			confirmations += 1;
			return route.fulfill({ status: 500 });
		});
		await page.route(`**${tokenPath}`, (route) =>
			route.fulfill({ status: 201, json: { token: "test-issued-token" } }),
		);
		const status = await page.evaluate(
			async (path) =>
				(await fetch(path, { method: "POST", body: "{}" })).status,
			tokenPath,
		);
		expect(status).toBe(201);
		expect(confirmations).toBe(0);
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});

	test("confirms the frozen operation with accessible mobile and desktop controls", async ({
		page,
	}) => {
		await page.route(`**${tokenPath}`, (route) =>
			route.fulfill({
				status: 403,
				json: { reason: "reauthentication_required" },
			}),
		);
		let attempts = 0;
		await page.route(`**${confirmationPath}`, (route) => {
			attempts += 1;
			const body = route.request().postDataJSON();
			expect(body.path).toBe("/api/v1/iam/principals/42/tokens");
			expect(body.body).toEqual({
				name: "Inventory reader",
				scope: { permissions: ["ReadObject"] },
			});
			expect(body.ifMatch).toBe('"revision:1"');
			return attempts === 1
				? route.fulfill({
						status: 403,
						json: {
							reason: "password_confirmation_failed",
							message: "Your current password was not accepted. Try again.",
						},
					})
				: route.fulfill({ status: 201, json: { token: "test-issued-token" } });
		});
		const result = page.evaluate(async (path) => {
			const response = await fetch(path, {
				method: "POST",
				headers: { "If-Match": '"revision:1"' },
				body: JSON.stringify({
					name: "Inventory reader",
					scope: { permissions: ["ReadObject"] },
				}),
			});
			return response.status;
		}, tokenPath);
		const dialog = page.getByRole("dialog", { name: "Confirm your password" });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel("Your current password")).toBeFocused();
		await expect(dialog).toContainText("principal #42");
		await expect(dialog).toContainText("ReadObject");
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			expect(
				(
					await new AxeBuilder({ page })
						.include('[role="dialog"]')
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze()
				).violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
		}
		await dialog
			.getByLabel("Your current password")
			.fill("incorrect-test-password");
		await dialog.getByRole("button", { name: "Confirm operation" }).click();
		await expect(dialog.getByRole("alert")).toContainText("not accepted");
		await expect(dialog.getByLabel("Your current password")).toHaveValue("");
		expect(attempts).toBe(1);
		await dialog.getByLabel("Your current password").fill("test-password");
		await dialog.getByRole("button", { name: "Confirm operation" }).click();
		expect(await result).toBe(201);
		await expect(dialog).toHaveCount(0);
	});

	test("Escape cancels without resubmitting and restores keyboard focus", async ({
		page,
	}) => {
		await page.route(`**${tokenPath}`, (route) =>
			route.fulfill({
				status: 403,
				json: { reason: "reauthentication_required" },
			}),
		);
		let confirmations = 0;
		await page.route(`**${confirmationPath}`, (route) => {
			confirmations += 1;
			return route.fulfill({ status: 500 });
		});
		await page.getByLabel("Username").focus();
		const result = page.evaluate(
			async (path) =>
				(await fetch(path, { method: "POST", body: "{}" })).status,
			tokenPath,
		);
		await expect(page.getByRole("dialog")).toBeVisible();
		await page.keyboard.press("Escape");
		expect(await result).toBe(409);
		expect(confirmations).toBe(0);
		await expect(page.getByLabel("Username")).toBeFocused();
	});

	test("ordinary permission errors never request a password", async ({
		page,
	}) => {
		await page.route(`**${tokenPath}`, (route) =>
			route.fulfill({ status: 403, json: { message: "Forbidden" } }),
		);
		expect(
			await page.evaluate(
				async (path) =>
					(await fetch(path, { method: "POST", body: "{}" })).status,
				tokenPath,
			),
		).toBe(403);
		await expect(page.getByRole("dialog")).toHaveCount(0);
	});
});
