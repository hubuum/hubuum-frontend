import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const runtime = "/_hubuum-bff/hubuum/api/v1/admin/runtime-settings";
const candidates = "/_hubuum-bff/admin/security-candidates";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const providerId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const capabilities = {
	activatable_provider_kinds: ["ldap", "oidc", "oauth"],
	configurable_provider_kinds: ["ldap", "oidc", "oauth"],
	candidate_endpoint: "/api/v1/admin/runtime-settings/security-candidates",
	candidate_lifetime_seconds: 300,
	deployment_locked_providers: [],
	ldap_verification_timeout_seconds: 60,
	private_targets_allowed: false,
	replacement_credentials_available: true,
	trust_profiles: ["system"],
	treetop_connect_timeout_ceiling_ms: 5000,
	treetop_request_timeout_ceiling_ms: 10000,
};
const provider = {
	provider_id: providerId,
	name: "company",
	kind: "ldap",
	source: "runtime",
	enabled: true,
	available: true,
	definition_mutable: true,
	credential_configured: true,
	runtime_definition: {
		scope: "company",
		url: "ldaps://directory.example",
		user_base_dn: "dc=example",
		user_filter: "(uid={username})",
		subject_attribute: "entryUUID",
		group_attributes: [],
		group_rules: [],
	},
};
function candidate(group = "authentication", state = "verified") {
	return {
		id,
		group,
		base_revision: 7,
		expires_at: new Date(Date.now() + 300000).toISOString(),
		state,
		providers:
			group === "authentication"
				? [{ provider_id: providerId, name: "company", kind: "ldap" }]
				: [],
		checks: [{ kind: "configuration", status: "passed", reason: "valid" }],
	};
}
async function mockSettings(
	page: Page,
	options: {
		group?: string;
		external?: boolean;
		unknown?: boolean;
		longName?: boolean;
		deploymentBackend?: "local" | "treetop" | "future";
	} = {},
) {
	const group = options.group ?? "authentication";
	const requests: Record<string, unknown>[] = [];
	await page.route("**/_hubuum-bff/auth/methods", (route) =>
		route.fulfill({
			json: {
				interaction_version: 1,
				methods: [
					{
						provider_id: "local",
						name: "local",
						kind: "local",
						interaction: "credentials",
						fresh_authentication: true,
						browser_available: true,
					},
				],
			},
		}),
	);
	await page.route("**/_hubuum-bff/hubuum/api/v1/iam/me", (route) =>
		route.fulfill({
			json: {
				principal: {
					identity_scope: options.external ? "company" : "local",
					kind: "human",
				},
				token: { scope: null },
			},
		}),
	);
	await page.route(`**${runtime}/schema`, (route) =>
		route.fulfill({
			json: {
				schema_version: 1,
				security: capabilities,
				groups: [
					{
						key: group,
						title:
							group === "authentication" ? "Authentication" : "Authorization",
						description: "Security settings",
						schema: {},
						patch_supported: false,
						requires_local_admin: true,
						takes_effect: "next_request",
					},
				],
			},
		}),
	);
	await page.route(`**${runtime}/${group}`, (route) =>
		route.fulfill({
			json: {
				group,
				source: "runtime",
				revision: 7,
				mutable: true,
				restart_required: false,
				takes_effect: "next_request",
				replica: { status: "current" },
				constrained_by_ceiling: false,
				effective:
					group === "authentication"
						? {
								providers: [
									{
										...provider,
										kind: options.unknown ? "future" : "ldap",
										...(options.longName
											? {
													name: "directory_" + "x".repeat(140),
													runtime_definition: {
														...provider.runtime_definition,
														scope: "directory_" + "x".repeat(140),
													},
												}
											: {}),
									},
								],
							}
						: { backend: "treetop" },
				deployment:
					group === "authorization"
						? { backend: options.deploymentBackend ?? "local" }
						: null,
				runtime:
					group === "authorization"
						? {
								backend: "treetop",
								connection: {
									url: "https://policy.example",
									trust_profile_id: "system",
									connect_timeout_ms: 1000,
									request_timeout_ms: 3000,
								},
							}
						: null,
			},
		}),
	);
	await page.route(`**${candidates}`, (route) => {
		requests.push(route.request().postDataJSON());
		return route.fulfill({ status: 201, json: candidate(group) });
	});
	await page.route(`**${candidates}/${id}`, (route) =>
		route.fulfill({
			json:
				route.request().method() === "DELETE"
					? { discarded: true }
					: candidate(group),
		}),
	);
	await page.goto("/admin/configuration");
	await page
		.getByRole("tab", {
			name: group === "authentication" ? /^Authentication/ : /^Authorization/,
		})
		.click();
	return { requests, panel: page.getByRole("tabpanel") };
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

test("provider metadata edits preserve the write-only credential and require explicit activation", async ({
	page,
}) => {
	const { requests, panel } = await mockSettings(page);
	await expect(
		panel.getByText("Local accounts — always on", { exact: true }),
	).toBeVisible();
	await panel.getByLabel("Enabled", { exact: true }).uncheck();
	await panel.getByRole("button", { name: "Prepare candidate" }).click();
	expect(requests).toMatchObject([
		{
			group: "authentication",
			expected_revision: 7,
			providers: [
				{ provider_id: providerId, enabled: false, source: "runtime" },
			],
		},
	]);
	const configuration = (
		requests[0].providers as { configuration: Record<string, unknown> }[]
	)[0].configuration;
	expect(configuration).not.toHaveProperty("bind_password");
	expect(configuration).not.toHaveProperty("bind_password_ref");
	await expect(
		panel.getByText("Changes remain inactive", { exact: false }),
	).toBeVisible();
	await expect(panel.getByLabel("Enabled", { exact: true })).toBeDisabled();
	expect(
		(
			await new AxeBuilder({ page })
				.include(".runtime-settings-editor")
				.analyze()
		).violations,
	).toEqual([]);
});

test("replacement values leave the form immediately and never appear in review or browser storage", async ({
	page,
}) => {
	const { requests, panel } = await mockSettings(page);
	await panel.getByLabel("Credential action").selectOption("replace");
	await panel
		.getByLabel("New credential (write only)")
		.fill("fixture-replacement-value");
	await panel.getByRole("button", { name: "Prepare candidate" }).click();
	expect(
		(requests[0].providers as { configuration: Record<string, unknown> }[])[0]
			.configuration,
	).toMatchObject({
		bind_password: "fixture-replacement-value",
		bind_password_ref: null,
	});
	await expect(panel.getByLabel("New credential (write only)")).toHaveValue("");
	await expect(
		panel.getByRole("region", { name: "Security candidate review" }),
	).not.toContainText("fixture-replacement-value");
	expect(
		await page.evaluate(() =>
			JSON.stringify({ ...localStorage, ...sessionStorage }),
		),
	).not.toContain("fixture-replacement-value");
});

test("candidate activation asks for local approval once and never replays a failed mutation", async ({
	page,
}) => {
	const { panel } = await mockSettings(page);
	let activations = 0;
	await page.route(`**${candidates}/${id}/activate`, (route) => {
		activations++;
		expect(route.request().postDataJSON()).toEqual({
			expected_revision: 7,
			password: "fixture-approval-value",
		});
		return route.fulfill({
			status: 412,
			json: { message: "The candidate changed. Recreate and test it again." },
		});
	});
	await panel.getByLabel("Enabled", { exact: true }).uncheck();
	await panel.getByRole("button", { name: "Prepare candidate" }).click();
	await panel.getByRole("button", { name: "Review activation" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Approve security activation",
	});
	await expect(dialog).toContainText(id);
	await expect(dialog).toContainText("revision 7");
	await dialog
		.getByLabel("Local administrator password")
		.fill("fixture-approval-value");
	expect(
		(await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
			.violations,
	).toEqual([]);
	await dialog.getByRole("button", { name: "Approve and activate" }).click();
	await expect(panel.getByRole("alert")).toContainText("candidate changed");
	await expect(
		panel.getByRole("button", { name: "Review activation" }),
	).toBeDisabled();
	expect(activations).toBe(1);
});

test("an external identity cannot edit runtime security configuration", async ({
	page,
}) => {
	const { panel, requests } = await mockSettings(page, { external: true });
	await expect(panel.getByRole("alert")).toContainText(
		"local, unscoped human administrator",
	);
	await expect(panel.getByLabel("Enabled", { exact: true })).toBeDisabled();
	expect(requests).toEqual([]);
});

test("an unknown provider leaves authentication read-only rather than omitting it", async ({
	page,
}) => {
	const { panel, requests } = await mockSettings(page, { unknown: true });
	await expect(panel.getByRole("alert")).toContainText("not supported");
	await expect(
		panel.getByRole("button", { name: "Prepare candidate" }),
	).toHaveCount(0);
	expect(requests).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
	test(`provider controls preserve long names and write-only intent on a narrow ${theme} screen`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: theme });
		const { panel } = await mockSettings(page, { longName: true });
		await panel.getByLabel("Credential action").selectOption("reference");
		await panel
			.getByLabel("Credential alias (write only)")
			.fill("fixture_" + "x".repeat(100));
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(
			(
				await new AxeBuilder({ page })
					.include(".runtime-settings-editor")
					.analyze()
			).violations,
		).toEqual([]);
		await panel.screenshot({
			path: testInfo.outputPath(`provider-admin-${theme}.png`),
		});
		await panel.getByLabel("Credential action").selectOption("clear");
		await expect(
			panel.getByText("For LDAP, remove the bind DN too", { exact: false }),
		).toBeVisible();
	});

	test(`Treetop settings preserve the requested backend on a narrow ${theme} screen`, async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: theme });
		const { panel, requests } = await mockSettings(page, {
			group: "authorization",
		});
		await expect(
			panel.getByRole("combobox", { name: "Backend", exact: true }),
		).toHaveValue("treetop");
		await panel.getByLabel("Connect timeout (ms)").fill("1200");
		await panel.getByRole("button", { name: "Prepare candidate" }).click();
		expect(requests).toMatchObject([
			{
				group: "authorization",
				backend: "treetop",
				source: "runtime",
				connection: {
					url: "https://policy.example",
					trust_profile_id: "system",
					connect_timeout_ms: 1200,
				},
			},
		]);
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(
			(
				await new AxeBuilder({ page })
					.include(".runtime-settings-editor")
					.analyze()
			).violations,
		).toEqual([]);
	});
}

test("releasing authorization uses the deployment selection and omits the runtime connection", async ({
	page,
}) => {
	const { panel, requests } = await mockSettings(page, {
		group: "authorization",
	});
	await panel
		.getByLabel("Release this group to deployment configuration")
		.check();
	await panel.getByRole("button", { name: "Prepare candidate" }).click();
	expect(requests).toEqual([
		{
			group: "authorization",
			expected_revision: 7,
			backend: "local",
			source: "deployment",
			release_ownership: true,
		},
	]);
	await expect(
		panel.getByText("Release runtime ownership to deployment local.", {
			exact: false,
		}),
	).toBeVisible();
});
test("releasing authorization is unavailable for an unknown deployment backend", async ({
	page,
}) => {
	const { panel } = await mockSettings(page, {
		group: "authorization",
		deploymentBackend: "future",
	});
	await expect(
		panel.getByLabel("Release this group to deployment configuration"),
	).toBeDisabled();
});
