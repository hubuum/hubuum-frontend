/** Production admin UI qualification. All credentials arrive on stdin; output
 * contains public IDs and closed stage/check names only. No retained profile. */
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { approveProvider } from "./browser-provider.mjs";

let browser;
let stage = "input";
const checks = [];
const reader = createInterface({ input: process.stdin });
const lines = reader[Symbol.asyncIterator]();
async function checkpoint(event, extra = {}) {
	process.stdout.write(`${JSON.stringify({ event, ...extra })}\n`);
	assert.equal((await lines.next()).value, "ok");
}
try {
	const input = JSON.parse((await lines.next()).value);
	assert.match(input.spki, /^[A-Za-z0-9+/]{43}=$/);
	assert(["id_token", "userinfo", "oauth", "ldap"].includes(input.profile));
	const origin = "https://localhost:48601";
	const kind =
		input.profile === "ldap"
			? "ldap"
			: input.profile === "oauth"
				? "oauth"
				: "oidc";
	browser = await chromium.launch({
		args: [`--ignore-certificate-errors-spki-list=${input.spki}`],
	});
	const context = await browser.newContext();
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	stage = "local-recovery-login";
	await page.goto(`${origin}/login?next=%2Fadmin%2Fconfiguration`);
	await page.getByLabel("Username", { exact: true }).fill("admin");
	await page.getByLabel("Password", { exact: true }).fill(input.localPassword);
	await page
		.getByRole("button", { name: "Enter workspace", exact: true })
		.click();
	await expect(page).toHaveURL(`${origin}/admin/configuration`);
	await page.getByRole("tab", { name: /^Authentication/ }).click();
	const panel = page.getByRole("tabpanel");
	await expect(
		panel.getByText("Local accounts — always on", { exact: true }),
	).toBeVisible();
	checks.push(
		"actual local recovery login opens provider administration before external setup",
	);
	stage = "runtime-definition";
	await panel
		.getByRole("button", {
			name: `Add ${kind === "ldap" ? "LDAP" : kind === "oidc" ? "OIDC" : "OAuth"} provider`,
		})
		.click();
	await panel.getByLabel("Provider name").fill("company");
	await panel
		.getByLabel("Non-secret provider settings (JSON)")
		.fill(JSON.stringify(input.configuration));
	await panel.getByLabel("Enabled", { exact: true }).check();
	await panel.getByLabel("Credential action").selectOption("replace");
	await panel.getByLabel("New credential (write only)").fill(input.credential);
	const createdResponse = page.waitForResponse(
		(response) =>
			response.url() === `${origin}/_hubuum-bff/admin/security-candidates` &&
			response.request().method() === "POST",
	);
	await panel.getByRole("button", { name: "Prepare candidate" }).click();
	const created = await createdResponse;
	assert.equal(created.status(), 201);
	const candidate = await created.json();
	assert.equal(candidate.group, "authentication");
	assert.equal(candidate.providers.length, 1);
	assert(!("verification_receipt" in candidate));
	const provider = candidate.providers[0].provider_id;
	assert.match(provider, /^[0-9a-f-]{36}$/);
	await expect(panel.getByLabel("New credential (write only)")).toHaveValue("");
	assert(!(await panel.textContent()).includes(input.credential));
	await checkpoint("candidate-created", { provider, candidate: candidate.id });
	checks.push(
		"actual provider form creates an inactive encrypted runtime candidate without displaying stored credentials or aliases",
	);
	stage = "non-provisioning-verification";
	await checkpoint("preview-before");
	if (kind === "ldap") {
		await panel.getByLabel("Test username").fill(input.username);
		await panel.getByLabel("Test password").fill(input.password);
		await panel.getByRole("button", { name: "Test LDAP provider" }).click();
	} else {
		await expect(
			panel.getByText(
				`${input.serverOrigin}/api/v1/auth/callbacks/${provider}`,
				{ exact: true },
			),
		).toBeVisible();
		await panel
			.getByRole("button", {
				name: `Test ${kind === "oidc" ? "OIDC" : "OAuth"} provider`,
			})
			.click();
		const popup = await approveProvider(page, input);
		await expect(
			panel.getByRole("region", { name: "Identity preview" }),
		).toBeVisible();
		await popup.close();
	}
	await expect(
		panel.getByRole("region", { name: "Identity preview" }),
	).toContainText("No account was provisioned and no login session was issued");
	await checkpoint("preview-after");
	checks.push(
		"actual provider test renders identity and groups with no provisioning, membership, session or retained-credential writes",
	);
	assert(
		(
			await new AxeBuilder({ page })
				.include(".runtime-settings-editor")
				.analyze()
		).violations.length === 0,
	);
	stage = "exact-activation";
	await panel.getByRole("button", { name: "Review activation" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Approve security activation",
	});
	await expect(dialog).toContainText(candidate.id);
	await expect(dialog).toContainText(`revision ${candidate.base_revision}`);
	assert(
		(await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
			.violations.length === 0,
	);
	await dialog
		.getByLabel("Local administrator password")
		.fill(input.localPassword);
	const activatedResponse = page.waitForResponse((response) =>
		response
			.url()
			.endsWith(`/admin/security-candidates/${candidate.id}/activate`),
	);
	await dialog.getByRole("button", { name: "Approve and activate" }).click();
	const activated = await activatedResponse;
	assert.equal(activated.status(), 200);
	const result = await activated.json();
	assert.equal(result.group, "authentication");
	assert.equal(result.revision, candidate.base_revision + 1);
	checks.push(
		"actual activation review uses a private receipt and fresh local approval for the exact candidate and revision",
	);
	stage = "local-recovery-after-activation";
	const recoveryContext = await browser.newContext();
	const recovery = await recoveryContext.newPage();
	await recovery.goto(`${origin}/login?next=%2Fhealthz`);
	await recovery.getByLabel("Authentication provider").selectOption("local");
	await recovery.getByLabel("Username", { exact: true }).fill("admin");
	await recovery
		.getByLabel("Password", { exact: true })
		.fill(input.localPassword);
	await recovery
		.getByRole("button", { name: "Enter workspace", exact: true })
		.click();
	await expect(recovery).toHaveURL(`${origin}/healthz`);
	assert(
		!JSON.stringify(
			await recovery.evaluate(() => ({ ...localStorage, ...sessionStorage })),
		).match(/hai1\.|hca1\.|hcv1\./),
	);
	checks.push(
		"actual local recovery login remains available after runtime provider activation and browser storage contains no authority",
	);
	process.stdout.write(
		`${JSON.stringify({ event: "complete", passed: true, provider, checks })}\n`,
	);
} catch (error) {
	process.stdout.write(
		`${JSON.stringify({ event: "failure", stage, type: error?.name ?? "Error" })}\n`,
	);
	process.exitCode = 1;
} finally {
	if (browser) await browser.close();
	reader.close();
	process.stdin.destroy();
}
