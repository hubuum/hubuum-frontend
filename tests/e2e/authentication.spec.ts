import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const provider = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const local = {
	provider_id: "local",
	name: "local",
	kind: "local",
	interaction: "credentials",
	fresh_authentication: true,
	browser_available: true,
};
function external(kind = "oidc", name = "Keycloak") {
	return {
		provider_id: provider,
		name,
		kind,
		interaction: "browser",
		fresh_authentication: kind === "oidc",
		browser_available: true,
	};
}
function handoff() {
	return {
		id: provider,
		nonce: "a".repeat(43),
		purpose: "login",
		expires_at: new Date(Date.now() + 300_000).toISOString(),
		interval_seconds: 1,
		next: {
			kind: "browser",
			verification_uri: "https://auth.example/api/v1/auth/interactions/browser",
			user_code: "PUBLIC-CODE",
		},
	};
}

// These are public BFF-wire UI tests; live provider/cookie acceptance has a
// separate production driver. No OIDC/OAuth behavior is implemented here.
for (const [kind, name] of [
	["oidc", "Keycloak"],
	["oauth", "GitHub"],
]) {
	test(`${name} renders only public handoff metadata and returns to the intended page`, async ({
		page,
	}) => {
		await page.route("**/_hubuum-bff/auth/methods", (route) =>
			route.fulfill({
				json: {
					interaction_version: 1,
					methods: [local, external(kind, name)],
				},
			}),
		);
		let begins = 0;
		await page.route("**/_hubuum-bff/auth/interactions", (route) => {
			begins++;
			expect(route.request().postDataJSON()).toEqual({
				provider_id: provider,
				purpose: "login",
				return_path: "/healthz",
			});
			return route.fulfill({ status: 201, json: handoff() });
		});
		await page.route("**/_hubuum-bff/auth/interactions/*/result", (route) => {
			expect(route.request().postDataJSON()).toEqual({ nonce: "a".repeat(43) });
			return route.fulfill({
				json: {
					state: "finished",
					purpose: "login",
					result: { authenticated: true },
				},
			});
		});
		await page.goto("/login?next=%2Fhealthz");
		await page.getByLabel("Authentication provider").selectOption(provider);
		await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: `Continue with ${name}` }).click();
		await expect(page.getByText("PUBLIC-CODE", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Open authentication page" }),
		).toHaveAttribute("rel", "noopener noreferrer");
		await expect(page).toHaveURL((url) => url.pathname === "/healthz");
		expect(begins).toBe(1);
		expect(
			await page.evaluate(() =>
				Object.keys(localStorage).some((key) =>
					/token|interaction|nonce/i.test(key),
				),
			),
		).toBe(false);
	});
}

test("denial preserves the chosen browser provider without a password downgrade", async ({
	page,
}) => {
	await page.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({
			json: { interaction_version: 1, methods: [local, external()] },
		}),
	);
	await page.route("**/_hubuum-bff/auth/interactions", (route) =>
		route.fulfill({ status: 201, json: handoff() }),
	);
	await page.route("**/_hubuum-bff/auth/interactions/*/result", (route) =>
		route.fulfill({
			json: {
				state: "finished",
				purpose: "login",
				result: {
					status: 403,
					body: { reason: "access_denied", message: "private-provider-detail" },
				},
			},
		}),
	);
	await page.goto("/login");
	await page.getByLabel("Authentication provider").selectOption(provider);
	await page.getByRole("button", { name: "Continue with Keycloak" }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"denied",
	);
	await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText(
		"private-provider-detail",
	);
});

test("concurrent tabs poll their own handoff and do not treat another tab's login as completion", async ({
	context,
	page,
}) => {
	await context.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({
			json: { interaction_version: 1, methods: [local, external()] },
		}),
	);
	const otherId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
	const flows = [
		{ ...handoff(), next: { ...handoff().next, user_code: "FIRST-CODE" } },
		{
			...handoff(),
			id: otherId,
			nonce: "b".repeat(43),
			next: { ...handoff().next, user_code: "SECOND-CODE" },
		},
	];
	let begins = 0;
	let accepted = false;
	await context.route("**/_hubuum-bff/auth/interactions", (route) =>
		route.fulfill({ status: 201, json: flows[begins++] }),
	);
	await context.route("**/_hubuum-bff/auth/interactions/*/result", (route) => {
		const first = route.request().url().includes(`/${provider}/result`);
		expect(route.request().postDataJSON()).toEqual({
			nonce: (first ? "a" : "b").repeat(43),
		});
		return route.fulfill({
			json: accepted
				? {
						state: "finished",
						purpose: "login",
						result: first
							? { authenticated: true }
							: { status: 403, body: { reason: "interaction_invalid" } },
					}
				: { state: "pending", interval_seconds: 1 },
		});
	});
	const other = await context.newPage();
	for (const [index, tab] of [page, other].entries()) {
		await tab.goto("/login?next=%2Fhealthz");
		await tab.getByLabel("Authentication provider").selectOption(provider);
		await tab.getByRole("button", { name: "Continue with Keycloak" }).click();
		await expect(
			tab.getByText(flows[index].next.user_code, { exact: true }),
		).toBeVisible();
	}
	accepted = true;
	await expect(page).toHaveURL((url) => url.pathname === "/healthz");
	await expect(other.getByRole("main").getByRole("alert")).toContainText(
		"Start again in this tab.",
	);
	await expect(other).toHaveURL((url) => url.pathname === "/login");
	await expect(other.getByLabel("Password", { exact: true })).toHaveCount(0);
	expect(begins).toBe(2);
});

test("a discovery outage requires explicit local recovery and never offers an external password", async ({
	page,
}) => {
	await page.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({ status: 503, json: { reason: "provider_unavailable" } }),
	);
	await page.goto("/login");
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"discovery is unavailable",
	);
	await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
	await page
		.getByRole("button", { name: "Use local recovery account" })
		.click();
	await expect(
		page.getByText("Local recovery uses local accounts only."),
	).toBeVisible();
	await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
	await expect(page.getByLabel("Identity scope", { exact: true })).toHaveCount(
		0,
	);
});

test("a removed remembered provider requires an explicit new provider choice", async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem("hubuum.login.identity-scope", "removed-company"),
	);
	await page.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({ json: { interaction_version: 1, methods: [local] } }),
	);
	await page.goto("/login");
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"previous provider is unavailable",
	);
	await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
	await page.getByLabel("Authentication provider").selectOption("local");
	await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
});

test("cancellation uses only the matching public nonce and does not begin another interaction", async ({
	page,
}) => {
	await page.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({
			json: { interaction_version: 1, methods: [local, external()] },
		}),
	);
	let begins = 0,
		cancellations = 0;
	await page.route("**/_hubuum-bff/auth/interactions", (route) => {
		begins++;
		return route.fulfill({ status: 201, json: handoff() });
	});
	await page.route("**/_hubuum-bff/auth/interactions/*/result", (route) =>
		route.fulfill({ json: { state: "pending", interval_seconds: 1 } }),
	);
	await page.route("**/_hubuum-bff/auth/interactions/*/cancel", (route) => {
		cancellations++;
		expect(route.request().postDataJSON()).toEqual({ nonce: "a".repeat(43) });
		return route.fulfill({ json: { cancelled: true } });
	});
	await page.goto("/login");
	await page.getByLabel("Authentication provider").selectOption(provider);
	await page.getByRole("button", { name: "Continue with Keycloak" }).click();
	await page.getByRole("button", { name: "Cancel authentication" }).click();
	await expect(
		page.getByRole("button", { name: "Continue with Keycloak" }),
	).toBeEnabled();
	expect([begins, cancellations]).toEqual([1, 1]);
});

for (const theme of ["light", "dark"]) {
	test(`provider choice and pending authentication are accessible on mobile in ${theme} mode`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await page.addInitScript(
			(value) => localStorage.setItem("hubuum.theme", value),
			theme,
		);
		await page.route("**/_hubuum-bff/auth/methods", (route) =>
			route.fulfill({
				json: { interaction_version: 1, methods: [local, external()] },
			}),
		);
		await page.route("**/_hubuum-bff/auth/interactions", (route) =>
			route.fulfill({ status: 201, json: handoff() }),
		);
		await page.route("**/_hubuum-bff/auth/interactions/*/result", (route) =>
			route.fulfill({ json: { state: "pending", interval_seconds: 1 } }),
		);
		await page.goto("/login");
		await page.getByLabel("Authentication provider").selectOption(provider);
		expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
		await page.getByRole("button", { name: "Continue with Keycloak" }).click();
		await expect(page.getByRole("status")).toContainText("Waiting");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
		await page.screenshot({
			path: test.info().outputPath(`browser-authentication-${theme}.png`),
			fullPage: true,
		});
	});
}

test("browser error returns have a friendly page while API callers retain typed errors", async ({
	page,
	request,
}) => {
	const url =
		"/_hubuum-bff/auth/interactions/return?interaction_id=invalid&nonce=invalid";
	const response = await request.get(url, {
		headers: { Accept: "application/json" },
	});
	expect(response.status()).toBe(401);
	expect((await response.json()).reason).toBe("interaction_invalid");
	await page.goto(url);
	await expect(
		page.getByRole("heading", { name: "Authentication stopped" }),
	).toBeVisible();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"another browser",
	);
});
