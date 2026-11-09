import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import type {
	RuntimeSettingsDescriptor,
	RuntimeSettingsState,
} from "@/lib/api/runtime-settings";

const root = "/_hubuum-bff/hubuum/api/v1/admin/runtime-settings";

async function mockSettings(page: Page, schemaVersion = 1) {
	const groups: RuntimeSettingsDescriptor[] = [
		{
			key: "authentication",
			title: "Authentication",
			description: "Shared sign-in policies.",
			patch_supported: false,
			requires_local_admin: true,
			takes_effect: "next_request",
			read_only_reason: "Use the dedicated authentication workflow.",
			schema: {
				properties: { enabled: { type: "boolean", title: "Password login" } },
			},
		},
		{
			key: "future_policy",
			title: "Future policy",
			description: "A group introduced by a newer server.",
			patch_supported: true,
			requires_local_admin: false,
			takes_effect: "next_query",
			schema: {
				properties: {
					limit: {
						type: "integer",
						title: "Pattern limit",
						minimum: 1,
						maximum: 100,
						"x-unit": "patterns",
						description: "Maximum number of patterns retained on each replica.",
					},
					enabled: {
						type: "boolean",
						title: "Collect observations",
						description: "Query execution is unaffected.",
					},
					mode: {
						type: "string",
						title: "Operating mode",
						enum: ["balanced", "fast"],
						"x-enum-descriptions": {
							balanced: "Balance speed and memory use.",
							fast: "Prefer speed with more memory use.",
						},
					},
					name: {
						type: "string",
						title: "Policy label",
						description: "A descriptive name for this policy.",
					},
				},
			},
		},
		{
			key: "pagination",
			title: "Pagination",
			description: "Default page size for requests without a limit.",
			patch_supported: true,
			requires_local_admin: false,
			takes_effect: "next_request",
			schema: {
				properties: {
					default_page_limit: {
						type: "integer",
						title: "Default page size",
						minimum: 1,
						"x-unit": "items",
					},
				},
			},
		},
	];
	const values: Record<string, Record<string, unknown>> = {
		authentication: { enabled: true },
		future_policy: {
			limit: 5,
			enabled: true,
			mode: "balanced",
			name: "Shared observations",
		},
		pagination: { default_page_limit: 50 },
	};
	const states: Record<string, RuntimeSettingsState> = Object.fromEntries(
		groups.map((group) => [
			group.key,
			{
				group: group.key,
				source: "runtime",
				revision: 4,
				mutable: group.patch_supported,
				restart_required: false,
				takes_effect: group.takes_effect,
				replica: { status: "current" },
				effective: values[group.key],
				runtime: values[group.key],
				deployment: null,
				constrained_by_ceiling: false,
			},
		]),
	);
	await page.route(`**${root}/schema`, (route) =>
		route.fulfill({ json: { schema_version: schemaVersion, groups } }),
	);
	const patches: { group: string; body: unknown }[] = [];
	for (const group of groups) {
		await page.route(`**${root}/${group.key}`, (route) => {
			const state = states[group.key];
			if (route.request().method() === "PATCH") {
				const body = route.request().postDataJSON();
				patches.push({ group: group.key, body });
				state.revision = (state.revision ?? 0) + 1;
				state.runtime = { ...state.runtime, ...body.changes };
				state.effective = state.runtime ?? {};
				return route.fulfill({
					json: {
						committed_revision: state.revision,
						applied_by_responding_replica: true,
					},
				});
			}
			return route.fulfill({ json: state });
		});
	}
	return { patches, states };
}

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

test("runtime configuration tabs preserve drafts and scope saves, discards and reloads to one group", async ({
	page,
}) => {
	const { patches } = await mockSettings(page);
	await page.goto("/admin/configuration");
	const policyTab = page.getByRole("tab", { name: /^Future policy/ });
	const paginationTab = page.getByRole("tab", { name: /^Pagination/ });
	const effectiveTab = page.getByRole("tab", {
		name: /^Effective configuration/,
	});
	await expect(policyTab).toHaveAttribute("aria-selected", "true");
	await expect(page.getByRole("tabpanel")).toHaveCount(1);
	const policy = page.getByRole("tabpanel", { name: /^Future policy/ });
	const limit = policy.getByRole("spinbutton", {
		name: "Pattern limit (patterns)",
	});
	await expect(
		policy.getByRole("button", { name: "Save changes" }),
	).toBeDisabled();
	await limit.fill("12");
	await policy
		.getByRole("checkbox", { name: "Collect observations" })
		.uncheck();
	await expect(policyTab).toContainText("Unsaved");
	await expect(policy.getByRole("status")).toHaveText("2 unsaved changes");

	await paginationTab.click();
	const pagination = page.getByRole("tabpanel", { name: /^Pagination/ });
	const pageSize = pagination.getByRole("spinbutton", {
		name: "Default page size (items)",
	});
	await pageSize.fill("75");
	await effectiveTab.click();
	await expect(
		page.getByRole("heading", { name: "Effective configuration", exact: true }),
	).toBeVisible();
	await expect(limit).not.toBeVisible();
	await expect(page.getByRole("tabpanel")).toHaveCount(1);
	await effectiveTab.press("Home");
	await expect(
		page.getByRole("tab", { name: /^Authentication/ }),
	).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(policyTab).toBeFocused();
	await expect(limit).toHaveValue("12");
	await expect(
		policy.getByRole("checkbox", { name: "Collect observations" }),
	).not.toBeChecked();
	await policy.getByRole("button", { name: "Discard", exact: true }).click();
	await expect(limit).toHaveValue("5");
	await expect(policyTab).not.toContainText("Unsaved");
	await expect(paginationTab).toContainText("Unsaved");
	await expect(
		policy.getByRole("checkbox", { name: "Collect observations" }),
	).toBeChecked();

	await limit.fill("7");
	await policy.getByRole("button", { name: "Save changes" }).click();
	await expect(
		policy.getByRole("status").filter({ hasText: "Saved revision" }),
	).toContainText("Saved revision 5");
	await expect(policyTab).not.toContainText("Unsaved");
	expect(patches).toEqual([
		{
			group: "future_policy",
			body: { expected_revision: 4, changes: { limit: 7 } },
		},
	]);
	await paginationTab.click();
	await expect(pageSize).toHaveValue("75");
	await pagination
		.getByRole("button", { name: "Discard", exact: true })
		.click();
	await pageSize.fill("050");
	await expect(
		pagination.getByRole("button", { name: "Save changes" }),
	).toBeDisabled();
	await expect(paginationTab).not.toContainText("Unsaved");
	await pageSize.fill("80");
	await pagination.getByText("Effective values", { exact: true }).click();
	await pagination.getByRole("button", { name: "Reload settings" }).click();
	await expect(pageSize).toHaveValue("50");
	await expect(paginationTab).not.toContainText("Unsaved");
	expect(patches).toHaveLength(1);
});

test("runtime configuration tabs remain accessible and responsive in both themes", async ({
	page,
}, testInfo) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	const { states } = await mockSettings(page);
	states.future_policy.constrained_by_ceiling = true;
	await page.goto("/admin/configuration");
	await expect(
		page.getByRole("tab", { name: /^Future policy/ }),
	).toHaveAttribute("aria-selected", "true");
	const panel = page.getByRole("tabpanel", { name: /^Future policy/ });
	await expect(
		panel.getByRole("status").filter({ hasText: "deployment limit" }),
	).toBeVisible();
	for (const theme of ["light", "dark"]) {
		await page.getByRole("button", { name: /Open account menu for/ }).click();
		await page
			.getByRole("button", {
				name: theme === "dark" ? "Dark" : "Light",
				exact: true,
			})
			.click();
		await page.keyboard.press("Escape");
		await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
		for (const width of [1440, 768, 390, 320]) {
			await page.setViewportSize({ width, height: 1000 });
			await page.evaluate(async () => {
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
				await Promise.all(
					document
						.getAnimations()
						.map((animation) => animation.finished.catch(() => undefined)),
				);
			});
			expect(
				(
					await new AxeBuilder({ page })
						.include('section[aria-label="Editable runtime settings"]')
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze()
				).violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			await page.screenshot({
				path: testInfo.outputPath(`configuration-${theme}-${width}.png`),
				fullPage: true,
			});
		}
	}
	await page.getByRole("tab", { name: /^Authentication/ }).click();
	const authentication = page.getByRole("tabpanel", {
		name: /^Authentication/,
	});
	await expect(
		authentication.getByText("Use the dedicated authentication workflow."),
	).toBeVisible();
	await expect(authentication.getByRole("checkbox")).toHaveCount(0);
	await expect(
		authentication.getByRole("button", { name: "Save changes" }),
	).toHaveCount(0);
});

for (const discovery of ["unavailable", "empty", "error"] as const) {
	test(`runtime configuration keeps the effective snapshot when discovery is ${discovery}`, async ({
		page,
	}) => {
		await page.route(`**${root}/schema`, (route) =>
			route.fulfill(
				discovery === "empty"
					? { json: { schema_version: 1, groups: [] } }
					: {
							status: discovery === "unavailable" ? 404 : 500,
							json: { message: "Settings discovery unavailable" },
						},
			),
		);
		await page.goto("/admin/configuration");
		await expect(
			page.getByRole("heading", {
				name: "Effective configuration",
				exact: true,
			}),
		).toBeVisible();
		await expect(page.getByRole("tab")).toHaveCount(1);
		await expect(
			page.getByRole("button", { name: "Save changes" }),
		).toHaveCount(0);
		if (discovery === "error") {
			await expect(
				page
					.getByRole("alert")
					.filter({ hasText: "Settings discovery unavailable" }),
			).toBeVisible();
		} else {
			await expect(
				page.getByText(/does not advertise editable runtime settings/),
			).toBeVisible();
		}
	});
}

test("runtime configuration shows newer catalogue versions as read-only tabs", async ({
	page,
}) => {
	await mockSettings(page, 2);
	await page.goto("/admin/configuration");
	await expect(page.getByText(/requires a newer frontend/)).toBeVisible();
	await page.getByRole("tab", { name: /^Future policy/ }).click();
	await expect(page.getByRole("spinbutton")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
		0,
	);
	await page.getByRole("tab", { name: /^Effective configuration/ }).click();
	await expect(
		page.getByRole("heading", { name: "Effective configuration", exact: true }),
	).toBeVisible();
});

test("edits a discovered pagination setting against the live server", async ({
	page,
}) => {
	const schema = await page.request.get(`${root}/schema`);
	expect(schema.status()).toBe(200);
	const originalResponse = await page.request.get(`${root}/pagination`);
	const original = await originalResponse.json();
	await page.goto("/admin/configuration");
	await page.getByRole("tab", { name: /^Pagination/ }).click();
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
		await card.getByRole("button", { name: "Save changes" }).click();
		await expect(
			card.getByRole("status").filter({ hasText: "Saved revision" }),
		).toContainText("Saved revision");
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
			complex_option: { retained: true, description: "x".repeat(512) },
			mode: "balanced",
		},
		runtime: {
			new_option: 5,
			complex_option: { retained: true, description: "x".repeat(512) },
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
	await card.getByRole("button", { name: "Save changes" }).click();
	await expect(card.getByRole("alert")).toContainText("Reload settings");
	expect(patches).toHaveLength(1);
	await card.getByRole("button", { name: "Reload settings" }).click();
	await expect(card.getByLabel("new option", { exact: true })).toHaveValue("5");
	await card.getByLabel("new option", { exact: true }).fill("12");
	await card.getByRole("button", { name: "Save changes" }).click();
	await expect(
		card.getByRole("status").filter({ hasText: "Saved revision" }),
	).toContainText("Saved revision 6");
	expect(patches).toEqual([
		{ expected_revision: 4, changes: { new_option: 12 } },
		{ expected_revision: 5, changes: { new_option: 12 } },
	]);
	await card.getByText("Effective values", { exact: true }).click();
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
