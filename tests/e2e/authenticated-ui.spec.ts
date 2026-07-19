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

	test("Escape closes the active account menu and restores focus", async ({
		page,
	}) => {
		const trigger = page.getByRole("button", {
			name: /Open account menu for/,
		});
		await trigger.click();
		await expect(page.getByLabel("User menu")).toBeVisible();

		await page.keyboard.press("Escape");

		await expect(page.getByLabel("User menu")).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("primary color survives an immediate page refresh", async ({ page }) => {
		await page.goto("/account/appearance");
		const primaryColors = page.getByRole("group", { name: "Primary color" });
		const selectedLabel =
			(
				await primaryColors.locator('button[aria-pressed="true"]').textContent()
			)?.trim() ?? "Teal";
		const targetLabel = selectedLabel === "Violet" ? "Blue" : "Violet";

		try {
			await primaryColors
				.getByRole("button", { name: targetLabel, exact: true })
				.click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-accent",
				targetLabel.toLocaleLowerCase(),
			);

			await page.reload();

			await expect(page.locator("html")).toHaveAttribute(
				"data-accent",
				targetLabel.toLocaleLowerCase(),
			);
			await expect(
				page
					.getByRole("group", { name: "Primary color" })
					.getByRole("button", { name: targetLabel, exact: true }),
			).toHaveAttribute("aria-pressed", "true");
		} finally {
			await page.goto("/account/appearance");
			const restored = page
				.getByRole("group", { name: "Primary color" })
				.getByRole("button", { name: selectedLabel, exact: true });
			await restored.click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-accent",
				selectedLabel.toLocaleLowerCase(),
			);
			await page.waitForTimeout(300);
		}
	});

	test("mobile resource pages expose one primary create action", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/collections");
		await expect(page.locator(".topbar .create-button")).toBeHidden();
		await expect(page.locator(".fab--create")).toBeVisible();
	});

	test("imports starts with a gated file-first workflow", async ({ page }) => {
		await page.goto("/imports");

		const fileTab = page.getByRole("tab", { name: /1\. File/ });
		const destinationTab = page.getByRole("tab", { name: /2\. Destination/ });
		const policiesTab = page.getByRole("tab", { name: /3\. Policies/ });
		const reviewTab = page.getByRole("tab", { name: /4\. Review/ });

		await expect(fileTab).toHaveAttribute("aria-selected", "true");
		await expect(destinationTab).toBeDisabled();
		await expect(policiesTab).toBeDisabled();
		await expect(reviewTab).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Choose file" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Continue to destination" }),
		).toBeDisabled();
	});

	test("exports separates running, templates, and history into task views", async ({
		page,
	}) => {
		await page.route("**/api/v1/export-templates**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: "[]",
			});
		});
		await page.goto("/exports");

		const runTab = page.getByRole("tab", { name: /Run export/ });
		const templatesTab = page.getByRole("tab", { name: /Templates/ });
		const historyTab = page.getByRole("tab", { name: /History/ });

		await expect(runTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Create an export" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Saved template/ }),
		).toHaveCount(0);
		const createTemplate = page.getByRole("button", {
			name: "Create a template",
		});
		await expect(createTemplate).toBeVisible();
		await createTemplate.click();
		await expect(page).toHaveURL(/\/exports\/templates\/new$/);
		await expect(
			page.getByRole("heading", { name: "Create export template" }),
		).toBeVisible();
		const targetTab = page.getByRole("tab", { name: /1\. Target/ });
		const filtersTab = page.getByRole("tab", { name: /2\. Filters/ });
		const relatedTab = page.getByRole("tab", { name: /3\. Related/ });
		const rulesTab = page.getByRole("tab", { name: /4\. Rules/ });
		const appearanceTab = page.getByRole("tab", { name: /5\. Appearance/ });
		const templateHistoryTab = page.getByRole("tab", { name: /History/ });
		await expect(targetTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Export target" }),
		).toBeVisible();
		await expect(appearanceTab).toBeDisabled();
		await expect(templateHistoryTab).toBeDisabled();
		await page.getByLabel("Scope").selectOption("collections");
		await expect(appearanceTab).toBeEnabled();
		await page
			.getByRole("button", { name: "Continue to filters" })
			.first()
			.click();
		await expect(filtersTab).toHaveAttribute("aria-selected", "true");
		await page.getByRole("button", { name: "Add filter" }).click();
		await expect(page.getByText("Filter 1", { exact: true })).toBeVisible();
		await page
			.getByRole("button", { name: "Continue to related" })
			.first()
			.click();
		await expect(relatedTab).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("button", { name: "Continue to rules" })
			.first()
			.click();
		await expect(rulesTab).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("button", { name: "Continue to appearance" })
			.first()
			.click();
		await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Test output" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Save", exact: true }).click();
		await expect(page.getByText(/Review \d+ fields?/)).toBeVisible();
		await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
		await page.getByRole("button", { name: "Back to templates" }).click();
		await expect(page).toHaveURL(/\/exports\?view=templates$/);
		await expect(templatesTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Template library" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create template" }),
		).toBeVisible();

		await historyTab.click();
		await expect(historyTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Recent export runs" }),
		).toBeVisible();
	});
});
