import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const root = "/_hubuum-bff/hubuum/api/v1/admin/runtime-settings";
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires a disposable authenticated server",
	);
	await page.goto("/login");
	const response = await page.request.post("/_hubuum-bff/auth/login", {
		headers: { Origin: new URL(page.url()).origin },
		data: {
			username: "admin",
			password: process.env.E2E_PASSWORD,
			identity_scope: "local",
		},
	});
	expect(response.status()).toBe(200);
});

test("edits a discovered pagination setting against the live server", async ({
	page,
}) => {
	const schema = await page.request.get(`${root}/schema`);
	test.skip(
		schema.status() === 404,
		"Server does not implement runtime settings discovery",
	);
	expect(schema.status()).toBe(200);
	const originalResponse = await page.request.get(`${root}/pagination`);
	const original = await originalResponse.json();
	await page.goto("/admin/configuration");
	const card = page.getByRole("article").filter({
		has: page.getByRole("heading", { name: "Pagination", exact: true }),
	});
	const next = original.effective.default_page_limit === 75 ? 76 : 75;
	try {
		const input = card.getByRole("spinbutton", {
			name: "Default page size (items)",
		});
		await expect(input).toHaveAccessibleDescription(
			/Requests with an explicit limit/,
		);
		await input.fill(String(next));
		await card.getByRole("button", { name: "Save settings" }).click();
		await expect(card.getByRole("status")).toContainText("Saved revision");
		const updated = await (await page.request.get(`${root}/pagination`)).json();
		expect(updated.effective.default_page_limit).toBe(next);
	} finally {
		const current = await (await page.request.get(`${root}/pagination`)).json();
		const headers = { Origin: new URL(page.url()).origin };
		const restored =
			original.source === "deployment"
				? await page.request.delete(
						`${root}/pagination?expected_revision=${current.revision}`,
						{ headers },
					)
				: await page.request.patch(`${root}/pagination`, {
						headers,
						data: {
							expected_revision: current.revision,
							changes: original.runtime,
						},
					});
		expect(restored.status()).toBe(200);
	}
});

test("renders future fields and requires review after a revision conflict", async ({
	page,
}, testInfo) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const state = {
		group: "future_policy",
		source: "runtime",
		revision: 4,
		mutable: true,
		restart_required: false,
		takes_effect: "next_request",
		replica: { status: "current" },
		effective: {
			new_option: 5,
			complex_option: { retained: true },
			mode: "balanced",
		},
		runtime: {
			new_option: 5,
			complex_option: { retained: true },
			mode: "balanced",
		},
		deployment: null,
		constrained_by_ceiling: false,
	};
	await page.route(`**${root}/schema`, (route) =>
		route.fulfill({
			json: {
				schema_version: 1,
				groups: [
					{
						key: "future_policy",
						title: "Future policy",
						description: "Added after this frontend was built.",
						schema: {
							type: "object",
							properties: {
								new_option: {
									type: "integer",
									minimum: 1,
									maximum: 20,
									description: "Controls the newly added limit.",
								},
								mode: {
									type: "string",
									title: "Operating mode",
									description: "Choose the balance of speed and resource use.",
									enum: ["balanced", "fast"],
									"x-enum-descriptions": {
										balanced: "Balance speed and resource use.",
										fast: "Prefer speed with more resource use.",
									},
								},
								complex_option: { type: "object" },
							},
						},
						patch_supported: true,
						requires_local_admin: false,
						takes_effect: "next_request",
						read_only_reason: null,
					},
				],
			},
		}),
	);
	const patches: unknown[] = [];
	await page.route(`**${root}/future_policy`, (route) => {
		if (route.request().method() === "GET")
			return route.fulfill({ json: state });
		patches.push(route.request().postDataJSON());
		if (patches.length === 1) {
			state.revision = 5;
			return route.fulfill({ status: 412, json: { current_revision: 5 } });
		}
		state.revision = 6;
		state.runtime.new_option = state.effective.new_option = 12;
		return route.fulfill({
			json: { committed_revision: 6, applied_by_responding_replica: true },
		});
	});
	await page.goto("/admin/configuration");
	const card = page
		.getByRole("article")
		.filter({ has: page.getByRole("heading", { name: "Future policy" }) });
	await expect(
		card.getByRole("combobox", { name: "Operating mode" }),
	).toHaveAccessibleDescription(/Prefer speed with more resource use/);
	await expect(
		card.getByText("Balance speed and resource use.", { exact: true }),
	).toBeVisible();
	await expect(
		card.getByLabel("new option", { exact: true }),
	).toHaveAccessibleDescription("Controls the newly added limit.");
	await card.getByLabel("new option", { exact: true }).fill("12");
	await card.getByRole("button", { name: "Save settings" }).click();
	await expect(card.getByRole("alert")).toContainText("Reload settings");
	expect(patches).toHaveLength(1);
	await card.getByRole("button", { name: "Reload settings" }).click();
	await expect(card.getByLabel("new option", { exact: true })).toHaveValue("5");
	await card.getByLabel("new option", { exact: true }).fill("12");
	await card.getByRole("button", { name: "Save settings" }).click();
	await expect(
		card.getByRole("status").filter({ hasText: "Saved revision" }),
	).toContainText("Saved revision 6");
	expect(patches).toEqual([
		{ expected_revision: 4, changes: { new_option: 12 } },
		{ expected_revision: 5, changes: { new_option: 12 } },
	]);
	expect(
		(
			await new AxeBuilder({ page })
				.include('section[aria-label="Editable runtime settings"]')
				.analyze()
		).violations,
	).toEqual([]);
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	await page
		.getByRole("heading", { name: "Runtime configuration", exact: true })
		.click();
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({
		path: testInfo.outputPath("runtime-settings-mobile.png"),
		fullPage: true,
	});
});
