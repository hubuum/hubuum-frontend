/** Actual Chromium return/session checks; input and cookies remain in memory.
 * TLS trusts only the disposable fixture's exact public-key pin. No tracing,
 * screenshots, profiles, provider credentials or raw errors are persisted. */
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

let browser;
try {
	let input = "";
	for await (const chunk of process.stdin) {
		input += chunk;
		assert(input.length <= 16384);
	}
	const { returnUrl, sid, spki } = JSON.parse(input);
	assert.match(sid, /^[0-9a-f-]{36}$/);
	assert.match(spki, /^[A-Za-z0-9+/]{43}=$/);
	const origin = "https://localhost:48601";
	assert.equal(new URL(returnUrl).origin, origin);
	assert.equal(
		new URL(returnUrl).pathname,
		"/_hubuum-bff/auth/interactions/return",
	);
	browser = await chromium.launch({
		args: [`--ignore-certificate-errors-spki-list=${spki}`],
	});
	const context = await browser.newContext();
	await context.addCookies([
		{
			name: "hubuum.sid",
			value: sid,
			url: origin,
			httpOnly: true,
			secure: true,
			sameSite: "Lax",
		},
	]);
	const page = await context.newPage();
	const response = await page.goto(returnUrl);
	assert.equal(response.status(), 200);
	assert.equal(page.url(), `${origin}/healthz`);
	const cookies = await context.cookies(origin);
	const installed = cookies.find((cookie) => cookie.name === "hubuum.sid");
	assert(installed?.httpOnly && installed.secure);
	assert.equal(installed.sameSite, "Lax");
	assert.notEqual(installed.value, sid);
	const visible = await page.evaluate(async () => {
		const response = await fetch("/_hubuum-bff/auth/session");
		return {
			status: response.status,
			cache: response.headers.get("cache-control"),
			session: await response.json(),
			cookie: document.cookie,
			local: localStorage.length,
			transient: sessionStorage.length,
		};
	});
	assert.equal(visible.status, 200);
	assert.match(visible.cache, /no-store/);
	assert(!visible.cookie.includes("hubuum.sid"));
	assert.equal(visible.local, 0);
	assert.equal(visible.transient, 0);
	function check(value) {
		if (typeof value === "string") assert(!/h(?:ai|ca|cv)1\./.test(value));
		if (value && typeof value === "object") {
			for (const [key, child] of Object.entries(value)) {
				assert(!["access_token", "refresh_token", "token", "redemption_secret"].includes(key));
				check(child);
			}
		}
	}
	check(visible.session);
	await page.goto(returnUrl);
	assert.equal((await context.cookies(origin)).find((cookie) => cookie.name === "hubuum.sid").value, installed.value);
	// Only the opaque browser cookie goes back to the parent fixture in memory.
	process.stdout.write(JSON.stringify({ sid: installed.value, passed: true }));
} catch {
	process.stderr.write("Production browser session security check failed.\n");
	process.exitCode = 1;
} finally {
	await browser?.close();
}
