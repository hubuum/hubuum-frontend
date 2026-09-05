import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";

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
	await page.getByLabel("Password").fill(password ?? "");
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
