import { expect, test } from "@playwright/test";

const accessSeconds = Number(process.env.E2E_SESSION_ACCESS_SECONDS);
test.use({ trace: "off", screenshot: "off", video: "off" });

test("the BFF rotates expired access without exposing either credential", async ({
	page,
}) => {
	test.skip(
		!process.env.E2E_PASSWORD || !(accessSeconds > 0 && accessSeconds <= 10),
		"Requires the disposable server with a short access lifetime.",
	);
	await page.goto("/login");
	const origin = new URL(page.url()).origin;
	const login = await page.request.post("/_hubuum-bff/auth/login", {
		headers: { Origin: origin },
		data: {
			username: process.env.E2E_USERNAME ?? "admin",
			password: process.env.E2E_PASSWORD,
			identity_scope: process.env.E2E_IDENTITY_SCOPE ?? "local",
		},
	});
	expect(login.status()).toBe(200);
	expect(await login.json()).toEqual({ authenticated: true });
	expect(login.headers()["cache-control"]).toContain("no-store");
	const cookies = await page.context().cookies();
	const session = cookies.find((cookie) => cookie.name === "hubuum.sid");
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe("Lax");
	expect(session?.value).not.toMatch(/hbt1\.|hbr1\./);

	// Cross the real server deadline, then make competing browser requests.
	await page.waitForTimeout((accessSeconds + 1) * 1000);
	const responses = await Promise.all(
		Array.from({ length: 10 }, () =>
			page.request.get("/_hubuum-bff/hubuum/api/v1/auth/validate"),
		),
	);
	for (const response of responses) expect(response.status()).toBe(200);
	const status = await page.request.get("/_hubuum-bff/auth/session");
	expect(status.status()).toBe(200);
	expect(status.headers()["cache-control"]).toContain("no-store");
	expect(Object.keys(await status.json()).sort()).toEqual([
		"authenticated",
		"createdAt",
		"lastSeen",
		"username",
	]);
	const logout = await page.request.post("/_hubuum-bff/auth/logout", {
		headers: { Origin: origin },
	});
	expect(logout.status()).toBe(200);
	expect((await page.request.get("/_hubuum-bff/auth/session")).status()).toBe(
		401,
	);
});
