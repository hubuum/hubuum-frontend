/** Actual product login/approval UI against disposable providers. Secrets arrive
 * only on stdin and stay in memory. No tracing, screenshots or browser profile. */
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import { approveProvider } from "./browser-provider.mjs";

let browser;
let stage = "input";
const checks = [];
const failures = [];
let proofTokenCleanup;
let currentPage;
let providerPage;
let authorizationAttempt = 0;
const providerResponses = [];
try {
	let raw = "";
	for await (const chunk of process.stdin) {
		raw += chunk;
		assert(raw.length < 16384);
	}
	const input = JSON.parse(raw);
	assert.match(input.spki, /^[A-Za-z0-9+/]{43}=$/);
	assert(
		["id_token", "userinfo", "oauth", "ldap", "local"].includes(input.profile),
	);
	const origin = "https://localhost:48601";
	assert.equal(new URL(input.serverOrigin).hostname, "localhost");
	browser = await chromium.launch({
		args: [`--ignore-certificate-errors-spki-list=${input.spki}`],
	});
	const context = await browser.newContext();
	const page = await context.newPage();
	currentPage = page;
	page.setDefaultTimeout(15000);
	const browserProvider = ["id_token", "userinfo", "oauth"].includes(
		input.profile,
	);
	let freshBegins = 0;
	context.on("response", async (response) => {
		if (
			response.status() < 400 ||
			!response.url().startsWith(`${origin}/_hubuum-bff/`)
		)
			return;
		const body = await response.json().catch(() => null);
		const known = [
			"reauthentication_required",
			"capability_unsupported",
			"access_denied",
			"provider_unavailable",
			"protocol_error",
			"password_confirmation_failed",
			"interaction_invalid",
		];
		failures.push({
			status: response.status(),
			reason: known.includes(body?.reason) ? body.reason : "unspecified",
		});
	});
	context.on("request", (request) => {
		if (
			request.method() === "POST" &&
			request.url() === `${origin}/_hubuum-bff/auth/interactions` &&
			request.postDataJSON()?.purpose === "credential_approval"
		)
			freshBegins++;
	});

	async function accessibleApproval(dialog) {
		const label = await dialog.getAttribute("aria-labelledby");
		assert.match(label, /^[A-Za-z0-9_:.-]+$/);
		const result = await new AxeBuilder({ page })
			.include(`[role="dialog"][aria-labelledby="${label}"]`)
			.analyze();
		assert.equal(result.violations.length, 0);
	}

	async function authorize(owner, decision = "Approve") {
		authorizationAttempt++;
		stage = "provider-authorization";
		return approveProvider(owner, input, decision, (popup) => {
			providerPage = popup;
			popup.on("response", (response) => {
				if (
					response.status() >= 400 &&
					new URL(response.url()).origin === input.serverOrigin
				)
					providerResponses.push({
						status: response.status(),
						path: new URL(response.url()).pathname,
					});
			});
		});
	}

	async function beginToken(owner, name) {
		await owner
			.getByRole("button", { name: "Create new", exact: true })
			.click();
		const form = owner.getByRole("dialog", {
			name: "Create token",
			exact: true,
		});
		await form.getByLabel("Name (optional)", { exact: true }).fill(name);
		await form
			.getByRole("button", { name: /Continue to Permission scope/i })
			.click();
		await form
			.getByRole("button", { name: /Continue to Resource scope/i })
			.click();
		await form.getByRole("button", { name: /^All resources/ }).click();
		await form.getByRole("button", { name: /Continue to Review/i }).click();
		await form
			.getByRole("button", { name: "Create token", exact: true })
			.click();
		return form;
	}

	async function revokeProofToken(name) {
		return page.evaluate(
			async ({ principalId, tokenName }) => {
				const response = await fetch(
					"/_hubuum-bff/hubuum/api/v1/iam/me/tokens?include_total=false",
				);
				const listed = await response.json();
				if (!Array.isArray(listed))
					return { list_status: response.status, array: false };
				const tokens = listed.filter((token) => token.name === tokenName);
				if (tokens.length !== 1)
					return {
						list_status: response.status,
						listed: listed.length,
						matching: tokens.length,
					};
				const path = `/_hubuum-bff/hubuum/api/v1/iam/principals/${principalId}/tokens/${tokens[0].id}`;
				const metadata = await fetch(path);
				const result = await fetch(`${path}/revoke`, {
					method: "POST",
					headers: { "If-Match": metadata.headers.get("ETag") },
				});
				return {
					list_status: response.status,
					matching: tokens.length,
					metadata_status: metadata.status,
					revoke_status: result.status,
				};
			},
			{ principalId: principal, tokenName: name },
		);
	}

	stage = "login-choice";
	await page.goto(`${origin}/login?next=%2Fhealthz`);
	if (input.profile !== "local")
		await page
			.getByLabel("Authentication provider")
			.selectOption(input.provider);
	if (browserProvider) {
		assert.equal(await page.getByLabel("Password", { exact: true }).count(), 0);
		await page
			.getByRole("button", { name: "Continue with company", exact: true })
			.click();
		const popup = await authorize(page);
		await expect(page).toHaveURL(`${origin}/healthz`, { timeout: 20000 });
		await popup.close();
		checks.push(
			"actual login UI opens the server-owned provider flow and requires explicit approval before the intended local return",
		);
	} else {
		await page.getByLabel("Username", { exact: true }).fill(input.username);
		await page.getByLabel("Password", { exact: true }).fill(input.password);
		await page
			.getByRole("button", { name: "Enter workspace", exact: true })
			.click();
		await expect(page).toHaveURL(`${origin}/healthz`, { timeout: 20000 });
		checks.push(
			"actual local or LDAP password login preserves the intended local return without a browser-provider downgrade",
		);
	}
	stage = "cookie-boundary";
	const cookie = (await context.cookies(origin)).find(
		(item) => item.name === "hubuum.sid",
	);
	assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Lax");
	assert.equal(
		await page.evaluate(() => document.cookie.includes("hubuum.sid")),
		false,
	);
	checks.push("the product UI receives only a Secure HttpOnly SameSite cookie");
	stage = "account";
	// The fixture forces eligibility refresh every five seconds. Concurrent
	// read-only layout requests may receive its explicit in-progress 503.
	// Reload only the read view; never replay a protected mutation.
	for (let attempt = 0; attempt < 3; attempt++) {
		const response = await page.goto(`${origin}/account/tokens`);
		if (response?.status() !== 503) break;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	await expect(
		page.getByRole("heading", { name: "Tokens", exact: true }),
	).toBeVisible();
	const principal = await page.evaluate(async () => {
		for (let attempt = 0; attempt < 3; attempt++) {
			const response = await fetch("/_hubuum-bff/hubuum/api/v1/iam/me");
			if (response.status === 503) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				continue;
			}
			return (await response.json()).principal?.principal_id;
		}
		return null;
	});
	assert(Number.isSafeInteger(principal));
	stage = "token-form";
	const creation = await beginToken(page, "ui-fresh-proof");
	stage = "fresh-capability";
	if (input.profile === "oauth") {
		const dialog = page.getByRole("dialog", {
			name: "Approve this operation",
			exact: true,
		});
		await expect(dialog.getByRole("alert")).toContainText("cannot approve");
		assert.equal(await dialog.getByLabel("Your current password").count(), 0);
		assert.equal(freshBegins, 0);
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(
			creation.getByRole("heading", { name: "Token created", exact: true }),
		).toHaveCount(0);
		await creation
			.getByRole("button", { name: "Close dialog", exact: true })
			.click();
		checks.push(
			"unsupported OAuth freshness is explained without password input, new interaction or protected mutation replay",
		);
	} else {
		if (browserProvider) {
			const dialog = page.getByRole("dialog", {
				name: "Approve this operation",
				exact: true,
			});
			await expect(dialog.locator("pre")).toContainText(
				`Create token for principal #${principal}`,
			);
			await expect(dialog.locator("pre")).toContainText("ui-fresh-proof");
			await accessibleApproval(dialog);
			assert.equal(await dialog.getByLabel("Your current password").count(), 0);
			await dialog
				.getByRole("button", { name: "Continue with company", exact: true })
				.focus();
			await page.keyboard.press("Enter");
			await expect(dialog.locator("pre")).toContainText("ui-fresh-proof");
			const popup = await authorize(page);
			stage = "token-issued";
			await expect(
				creation.getByRole("heading", { name: "Token created", exact: true }),
			).toBeVisible({ timeout: 20000 });
			assert.equal(freshBegins, 1);
			await popup.close();
		} else {
			stage = "password-approval-dialog";
			const dialog = page.getByRole("dialog", {
				name: "Confirm your password",
				exact: true,
			});
			await expect(dialog.locator("pre")).toContainText("ui-fresh-proof");
			await accessibleApproval(dialog);
			await expect(dialog.getByLabel("Your current password")).toBeFocused();
			stage = "password-approval-submit";
			await dialog.getByLabel("Your current password").fill(input.password);
			await dialog
				.getByRole("button", { name: "Confirm operation", exact: true })
				.click();
			stage = "token-issued";
			await expect(
				creation.getByRole("heading", { name: "Token created", exact: true }),
			).toBeVisible();
		}
		await creation.getByRole("button", { name: "Done", exact: true }).click();
		checks.push(
			"the actual approval dialog displays the frozen operation and completes it once through the supported authentication method",
		);
		stage = "revoke-proof-token";
		proofTokenCleanup = await revokeProofToken("ui-fresh-proof");
		assert.equal(proofTokenCleanup.revoke_status, 204);
		checks.push(
			"one issued proof token is found and explicitly revoked without exposing its value in reports",
		);
		if (browserProvider) {
			stage = "concurrent-approval-tabs";
			const other = await context.newPage();
			other.setDefaultTimeout(15000);
			await other.goto(`${origin}/account/tokens`);
			const firstForm = await beginToken(page, "ui-tab-approved");
			const secondForm = await beginToken(other, "ui-tab-denied");
			for (const [owner, name] of [
				[page, "ui-tab-approved"],
				[other, "ui-tab-denied"],
			]) {
				const dialog = owner.getByRole("dialog", {
					name: "Approve this operation",
					exact: true,
				});
				await expect(dialog.locator("pre")).toContainText(name);
				await dialog
					.getByRole("button", { name: "Continue with company", exact: true })
					.click();
				await expect(
					owner.getByRole("region", { name: "Browser authentication" }),
				).toBeVisible();
				await expect(dialog.locator("pre")).toContainText(name);
			}
			const acceptedPopup = await authorize(page);
			await expect(
				firstForm.getByRole("heading", { name: "Token created", exact: true }),
			).toBeVisible({ timeout: 20000 });
			await firstForm
				.getByRole("button", { name: "Done", exact: true })
				.click();
			await acceptedPopup.close();
			const deniedPopup = await authorize(other, "Deny");
			await expect(
				secondForm
					.getByRole("alert")
					.or(
						other
							.getByRole("region", { name: "Browser authentication" })
							.getByRole("alert"),
					)
					.first(),
			).toContainText("denied", { timeout: 20000 });
			await expect(
				secondForm.getByRole("heading", { name: "Token created", exact: true }),
			).toHaveCount(0);
			const counts = await page.evaluate(async () => {
				const response = await fetch(
					"/_hubuum-bff/hubuum/api/v1/iam/me/tokens?include_total=false",
				);
				const tokens = await response.json();
				return {
					approved: tokens.filter((token) => token.name === "ui-tab-approved")
						.length,
					denied: tokens.filter((token) => token.name === "ui-tab-denied")
						.length,
				};
			});
			assert.deepEqual(counts, { approved: 1, denied: 0 });
			assert.equal(
				(await revokeProofToken("ui-tab-approved")).revoke_status,
				204,
			);
			await deniedPopup.close();
			await other.close();
			checks.push(
				"separate concurrent tabs keep exact operations isolated: one approval mints once while denial in the other mints nothing, and both preserve the ordinary session",
			);
		}
	}
	if (browserProvider) {
		stage = "due-eligibility-after-concurrent-decisions";
		assert.equal(input.eligibilityInterval, 30);
		await new Promise((resolve) => setTimeout(resolve, 31000));
		const renewed = await page.evaluate(async () => {
			for (let attempt = 0; attempt < 3; attempt++) {
				const response = await fetch("/_hubuum-bff/hubuum/api/v1/iam/me");
				if (response.status === 503) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					continue;
				}
				const body = await response.json();
				return {
					status: response.status,
					principal: body.principal?.principal_id,
				};
			}
			return { status: 503 };
		});
		assert.equal(renewed.status, 200);
		assert.equal(renewed.principal, principal);
		checks.push(
			input.profile === "oauth"
				? "the ordinary OAuth session retains the same principal after due eligibility renewal and explicit unsupported-freshness handling"
				: "the ordinary session retains the same principal after a due upstream eligibility refresh following concurrent approval and denial",
		);
	}
	stage = "storage-boundary";
	assert.equal(
		await page.evaluate(() => {
			for (const store of [localStorage, sessionStorage])
				for (const key of Object.keys(store)) {
					if (
						/redemption_secret|access_token|refresh_token|verification_receipt|hai1\.|hca1\.|hcv1\./.test(
							key + store.getItem(key),
						)
					)
						return false;
				}
			return true;
		}),
		true,
	);
	checks.push(
		"browser storage contains no interaction, session or approval credential",
	);
	stage = "logout";
	assert.equal(
		await page.evaluate(
			async () =>
				(await fetch("/_hubuum-bff/auth/logout", { method: "POST" })).status,
		),
		200,
	);
	assert.equal(
		await page.evaluate(
			async () => (await fetch("/_hubuum-bff/auth/session")).status,
		),
		401,
	);
	checks.push("product logout destroys the matching frontend login");
	process.stdout.write(JSON.stringify({ passed: true, checks }));
} catch (error) {
	const message = error instanceof Error ? error.message : "";
	const failureKind = /Execution context was destroyed|navigation/i.test(
		message,
	)
		? "navigation"
		: /JSON|Unexpected token|Unexpected end/.test(message)
			? "json"
			: error instanceof Error
				? error.name
				: "unknown";
	process.stderr.write(
		JSON.stringify({
			passed: false,
			stage,
			checks,
			failures,
			proofTokenCleanup,
			failureKind,
			authorizationAttempt,
			providerResponses,
			providerPath:
				providerPage && !providerPage.isClosed()
					? new URL(providerPage.url()).pathname
					: undefined,
			providerReason:
				providerPage && !providerPage.isClosed()
					? (() => {
							const reason = new URL(providerPage.url()).searchParams.get(
								"error",
							);
							return [
								"interaction_invalid",
								"interaction_failed",
								"interaction_expired",
								"interaction_consumed",
								"configuration_changed",
								"protocol_error",
								"provider_unavailable",
								"capability_unsupported",
								"access_denied",
								"invalid_request",
							].includes(reason)
								? reason
								: "unspecified";
						})()
					: undefined,
			providerState:
				providerPage && !providerPage.isClosed()
					? await providerPage
							.locator("body")
							.textContent()
							.then((text) =>
								[
									"Authentication stopped",
									"Invalid authentication interaction or credentials",
									"Approve this request?",
									"Enter a new code",
								].filter((known) => text?.includes(known)),
							)
							.catch(() => [])
					: [],
			currentPath: currentPage
				? new URL(currentPage.url()).pathname
				: undefined,
		}),
	);
	process.exitCode = 1;
} finally {
	await browser?.close();
}
