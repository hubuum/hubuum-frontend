import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";

test.describe("authenticated workspace", () => {
	test.skip(
		!username || !password,
		"Set E2E_USERNAME and E2E_PASSWORD to run authenticated flows.",
	);

	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		const provider = page.locator("#identity-scope");
		await expect(provider).toBeVisible();
		if ((await provider.evaluate((element) => element.tagName)) === "SELECT") {
			await provider.selectOption(identityScope);
		} else {
			await provider.fill(identityScope);
		}
		await page.getByLabel("Username").fill(username ?? "");
		await page.getByLabel("Password").fill(password ?? "");
		await page.getByRole("button", { name: "Enter workspace" }).click();
		await page.waitForURL("**/app");
	});

	test("dashboard has no serious accessibility violations", async ({
		page,
	}) => {
		const results = await new AxeBuilder({ page }).analyze();
		expect(
			results.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			),
		).toEqual([]);
	});

	test("mobile search traps and restores focus", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		const trigger = page.getByRole("button", { name: "Search workspace" });
		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "Search workspace" });
		await expect(dialog).toBeVisible();
		await expect(page.locator("#mobile-workspace-search")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("mobile resource pages expose one primary create action", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/collections");
		await expect(page.locator(".topbar .create-button")).toBeHidden();
		await expect(page.locator(".fab--create")).toBeVisible();
	});
});
