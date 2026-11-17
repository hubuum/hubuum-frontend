/** Actual runtime authorization UI; private input/checkpoints, closed output. */
import assert from "node:assert/strict";
import { createInterface } from "node:readline";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";

const reader = createInterface({ input: process.stdin });
const lines = reader[Symbol.asyncIterator]();
const checks = [];
let browser;
let stage = "input";
const responses = [];
async function checkpoint(event) {
	process.stdout.write(`${JSON.stringify({ event })}\n`);
	assert.equal((await lines.next()).value, "ok");
}
try {
	const input = JSON.parse((await lines.next()).value);
	assert.match(input.spki, /^[A-Za-z0-9+/]{43}=$/);
	assert.equal(new URL(input.treetopUrl).protocol, "https:");
	const origin = "https://localhost:48601";
	browser = await chromium.launch({
		args: [`--ignore-certificate-errors-spki-list=${input.spki}`],
	});
	async function login(returnPath) {
		const context = await browser.newContext();
		const page = await context.newPage();
		page.on("response", (response) => {
			const url = new URL(response.url());
			if (
				url.origin === origin &&
				(url.pathname === "/_hubuum-bff/auth/login" ||
					url.pathname === "/_hubuum-bff/hubuum/api/v1/iam/me")
			)
				responses.push({
					stage,
					path: url.pathname,
					status: response.status(),
				});
		});
		page.setDefaultTimeout(20000);
		await page.goto(`${origin}/login?next=${encodeURIComponent(returnPath)}`);
		await page.getByLabel("Username", { exact: true }).fill("admin");
		await page
			.getByLabel("Password", { exact: true })
			.fill(input.localPassword);
		await page
			.getByRole("button", { name: "Enter workspace", exact: true })
			.click();
		await expect(page).toHaveURL(origin + returnPath);
		return { context, page };
	}
	stage = "local-administrator-login";
	const { page } = await login("/admin/configuration");
	async function openAuthorization() {
		await page.goto(`${origin}/admin/configuration`);
		await page.getByRole("tab", { name: /^Authorization/ }).click();
		return page.getByRole("tabpanel");
	}
	let panel = await openAuthorization();
	async function current(expectedBackend, expectedRevision, expectedSource) {
		for (let attempt = 0; attempt < 30; attempt++) {
			const state = await page.evaluate(async () => {
				const response = await fetch(
					"/_hubuum-bff/hubuum/api/v1/admin/runtime-settings/authorization",
				);
				return response.ok ? response.json() : null;
			});
			if (
				state?.effective?.backend === expectedBackend &&
				state.revision === expectedRevision &&
				state.replica?.status === "current" &&
				(!expectedSource || state.source === expectedSource)
			)
				return state;
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
		throw Error("Applied authorization state did not match");
	}
	async function prepare() {
		const responseEvent = page.waitForResponse(
			(response) =>
				response.url() === `${origin}/_hubuum-bff/admin/security-candidates` &&
				response.request().method() === "POST",
		);
		await panel.getByRole("button", { name: "Prepare candidate" }).click();
		return responseEvent;
	}
	async function activate(candidate) {
		assert.equal(candidate.state, "verified");
		assert.equal(candidate.group, "authorization");
		assert(!("verification_receipt" in candidate));
		await panel.getByRole("button", { name: "Review activation" }).click();
		const dialog = page.getByRole("dialog", {
			name: "Approve security activation",
		});
		await expect(dialog).toContainText(candidate.id);
		await expect(dialog).toContainText(`revision ${candidate.base_revision}`);
		await expect(
			dialog.getByLabel("Local administrator password"),
		).toBeFocused();
		assert.equal(
			(await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
				.violations.length,
			0,
		);
		await dialog
			.getByLabel("Local administrator password")
			.fill(input.localPassword);
		const responseEvent = page.waitForResponse((response) =>
			response
				.url()
				.endsWith(`/admin/security-candidates/${candidate.id}/activate`),
		);
		await dialog.getByLabel("Local administrator password").press("Enter");
		const response = await responseEvent;
		assert.equal(response.status(), 200);
		assert.equal((await response.json()).revision, candidate.base_revision + 1);
	}
	await current("local", 1);
	stage = "unreachable-policy-service";
	await panel
		.getByRole("combobox", { name: "Backend", exact: true })
		.selectOption("treetop");
	await panel
		.getByRole("combobox", { name: "Connection source", exact: true })
		.selectOption("runtime");
	await panel
		.getByLabel("Treetop HTTPS URL")
		.fill("https://host.docker.internal:1");
	await panel
		.getByRole("combobox", { name: "Trust profile", exact: true })
		.selectOption("deployment");
	await panel.getByLabel("Connect timeout (ms)").fill("1000");
	await panel.getByLabel("Request timeout (ms)").fill("3000");
	assert((await prepare()).status() >= 400);
	await expect(panel.getByRole("alert")).toBeVisible();
	await current("local", 1);
	checks.push(
		"unreachable runtime Treetop preflight leaves live Local authorization and revision unchanged",
	);
	stage = "recovery-policy-denied";
	await panel.getByLabel("Treetop HTTPS URL").fill(input.treetopUrl);
	assert((await prepare()).status() >= 400);
	await current("local", 1);
	await checkpoint("recovery-login");
	checks.push(
		"a real deny policy cannot activate or remove the existing local recovery path",
	);
	stage = "verified-remote-candidate";
	await checkpoint("allow-policy");
	await checkpoint("candidate-before");
	const prepared = await prepare();
	assert.equal(prepared.status(), 201);
	const remote = await prepared.json();
	await checkpoint("candidate-after");
	await current("local", 1);
	assert.equal(
		(
			await new AxeBuilder({ page })
				.include(".runtime-settings-editor")
				.analyze()
		).violations.length,
		0,
	);
	await activate(remote);
	await current("treetop", 2, "runtime");
	checks.push(
		"real Treetop connectivity and recovery checks prepare an inactive candidate, then exact local approval activates revision two",
	);
	stage = "server-and-frontend-restart";
	await checkpoint("restart");
	panel = await openAuthorization();
	await current("treetop", 2, "runtime");
	await expect(
		panel.getByRole("combobox", { name: "Backend", exact: true }),
	).toHaveValue("treetop");
	checks.push(
		"runtime Treetop ownership and the private ordinary session survive server and frontend process restart",
	);
	stage = "policy-outage";
	await checkpoint("outage");
	const status = await page.evaluate(
		async () => (await fetch("/_hubuum-bff/hubuum/api/v1/admin/config")).status,
	);
	assert.equal(status, 503);
	stage = "policy-outage-local-browser-login";
	const recovery = await login("/healthz");
	await recovery.context.close();
	await checkpoint("recovery-login");
	checks.push(
		"policy outage fails protected access closed while actual local password login remains available; no Local fallback is accepted",
	);
	stage = "policy-reconnect";
	await checkpoint("recover");
	panel = await openAuthorization();
	await current("treetop", 2, "runtime");
	checks.push(
		"real policy service recovery restores administrator access without changing the requested backend or revision",
	);
	stage = "explicit-local-activation";
	await panel
		.getByRole("combobox", { name: "Backend", exact: true })
		.selectOption("local");
	await checkpoint("candidate-before");
	const localResponse = await prepare();
	assert.equal(localResponse.status(), 201);
	const local = await localResponse.json();
	await checkpoint("candidate-after");
	await activate(local);
	await current("local", 3, "runtime");
	checks.push(
		"switching back to Local is a separate verified and freshly approved runtime change",
	);
	stage = "deployment-ownership-release";
	panel = await openAuthorization();
	await panel
		.getByRole("checkbox", {
			name: "Release this group to deployment configuration",
		})
		.check();
	await checkpoint("candidate-before");
	const releaseResponse = await prepare();
	assert.equal(releaseResponse.status(), 201);
	const release = await releaseResponse.json();
	await checkpoint("candidate-after");
	await activate(release);
	await current("local", 4, "deployment");
	await checkpoint("restart");
	await openAuthorization();
	await current("local", 4, "deployment");
	checks.push(
		"reviewed release restores deployment ownership and remains applied across restart",
	);
	process.stdout.write(
		`${JSON.stringify({ event: "complete", passed: true, checks })}\n`,
	);
} catch (error) {
	process.stdout.write(
		`${JSON.stringify({ event: "failure", stage, type: error?.name ?? "Error", responses })}\n`,
	);
	process.exitCode = 1;
} finally {
	if (browser) await browser.close();
	reader.close();
	process.stdin.destroy();
}
