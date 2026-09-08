import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";

test("About requires sign-in", async ({ page }) => {
	await page.goto("/about");
	await expect(page).toHaveURL(/\/login(?:\?|$)/);
});

test("About shows both versions and works on desktop and mobile", async ({
	page,
	request,
}, testInfo) => {
	test.skip(
		!username || !password,
		"Requires the disposable authenticated test stack.",
	);
	await page.goto("/login");
	await expect(
		page.getByRole("form", { name: "Login form" }),
	).not.toHaveAttribute("data-provider-discovery", "loading");
	const provider = page.locator("#identity-scope");
	if (await page.locator("select#identity-scope").isVisible()) {
		await provider.selectOption(identityScope);
	} else if ((await provider.getAttribute("type")) !== "hidden") {
		await provider.fill(identityScope);
	}
	await page.getByLabel("Username").fill(username ?? "");
	await page.getByLabel("Password", { exact: true }).fill(password ?? "");
	await page.getByRole("button", { name: "Enter workspace" }).click();
	await page.waitForURL("**/app");

	await page.getByRole("button", { name: /Open account menu for/ }).click();
	await page
		.getByRole("region", { name: "User menu" })
		.getByRole("link", { name: "About Hubuum", exact: true })
		.click();
	await expect(page).toHaveURL(/\/about$/);
	await expect(page).toHaveTitle("About · Hubuum");
	await expect(
		page.getByRole("heading", { name: "About Hubuum" }),
	).toBeVisible();
	const health = await request.get("/healthz");
	const frontendVersion = (await health.json()).version;
	await expect(
		page.getByRole("article", { name: "Hubuum Frontend" }),
	).toContainText(frontendVersion);
	await expect(
		page.getByRole("article", { name: "Hubuum Server" }).locator("dd"),
	).toHaveText(/\d+\.\d+\.\d+/);

	for (const theme of ["light", "dark"]) {
		await page.getByRole("button", { name: /Open account menu for/ }).click();
		await page
			.getByRole("button", {
				name: theme === "light" ? "Light" : "Dark",
				exact: true,
			})
			.click();
		await page.keyboard.press("Escape");
		for (const width of [1440, 390]) {
			await page.setViewportSize({ width, height: 900 });
			await expect(
				page.getByRole("heading", { name: "About Hubuum" }),
			).toBeVisible();
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
			await page.screenshot({
				path: testInfo.outputPath(`about-${theme}-${width}.png`),
				fullPage: true,
			});
		}
	}

	await page
		.getByRole("button", { name: "Go to or create", exact: true })
		.click();
	await page.getByLabel("Find a destination or action").fill("About");
	await expect(
		page.getByRole("dialog").getByRole("link", { name: "About", exact: true }),
	).toBeVisible();
});

test("login, session validation, and logout work against a live backend", async ({
	page,
}) => {
	test.skip(
		!username || !password,
		"Set E2E_USERNAME and E2E_PASSWORD to run the authenticated smoke test.",
	);

	await page.goto("/login");
	const provider = page.locator("#identity-scope");
	await expect(
		page.getByRole("form", { name: "Login form" }),
	).not.toHaveAttribute("data-provider-discovery", "loading");
	const providerSelect = page.locator("select#identity-scope");
	if (await providerSelect.isVisible()) {
		await providerSelect.selectOption(identityScope);
	} else if ((await provider.getAttribute("type")) !== "hidden") {
		await provider.fill(identityScope);
	}
	await page.getByLabel("Username").fill(username ?? "");
	await page.getByLabel("Password", { exact: true }).fill(password ?? "");
	await page.getByRole("button", { name: "Enter workspace" }).click();
	await page.waitForURL("**/app");

	const session = await page.evaluate(async () => {
		const response = await fetch("/_hubuum-bff/auth/session", {
			credentials: "include",
		});
		return {
			body: (await response.json()) as unknown,
			status: response.status,
		};
	});
	expect(session.status).toBe(200);
	expect(session.body).toMatchObject({
		authenticated: true,
		username: "admin",
	});

	await page.getByRole("button", { name: /Open account menu for/ }).click();
	await page.getByRole("button", { name: "Sign out" }).click();
	await page.waitForURL("**/login");

	const loggedOutStatus = await page.evaluate(async () => {
		return (
			await fetch("/_hubuum-bff/auth/session", {
				credentials: "include",
			})
		).status;
	});
	expect(loggedOutStatus).toBe(401);

	await page.goto("/app");
	await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
