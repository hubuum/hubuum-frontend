import { createServer, type RequestListener, type Server } from "node:http";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import Redis from "ioredis";
import { sessionCredentials } from "../../src/test/session-fixtures";

test.use({
	trace: "off",
	video: "off",
	screenshot: "off",
	actionTimeout: 10_000,
});

test.describe("installation setup", () => {
	test.setTimeout(120_000);
	test.skip(
		process.env.E2E_SETUP !== "1",
		"Run with npm run test:e2e:setup and its disposable Valkey.",
	);
	let server: Server;
	let secondServer: Server;
	let origin: string;
	let secondOrigin: string;
	let version = "0.0.21";
	let ready = true;
	let identified = true;
	let providerRequests = 0;
	let misdirectedCredentials = 0;
	const contract = JSON.parse(readFileSync("openapi.json", "utf8"));

	test.beforeAll(async () => {
		const handler: RequestListener = (request, response) => {
			const first =
				request.socket.localPort ===
				(server.address() as { port: number }).port;
			const token = first ? "first-fixture-token" : "second-fixture-token";
			if (
				request.headers.authorization &&
				request.headers.authorization !== `Bearer ${token}`
			)
				misdirectedCredentials++;
			response.setHeader("Content-Type", "application/json");
			if (request.url === "/readyz") {
				response.statusCode = ready ? 200 : 503;
				response.end("{}");
			} else if (request.url === "/api-doc/openapi.json") {
				response.end(
					JSON.stringify({
						...contract,
						info: {
							...contract.info,
							title: identified ? "Hubuum REST API" : "Another service",
							version,
						},
					}),
				);
			} else if (request.url === "/api/v1/config") {
				response.end(
					JSON.stringify({
						authentication: {
							session_access_seconds: 300,
							session_idle_seconds: 3600,
							session_absolute_seconds: 28800,
						},
						pagination: { default_page_limit: 50, max_page_limit: 250 },
					}),
				);
			} else if (request.url === "/api/v1/auth/providers") {
				providerRequests++;
				response.end(JSON.stringify({ providers: [] }));
			} else if (request.url === "/api/v1/auth/login") {
				response.end(
					JSON.stringify(sessionCredentials({ access_token: token })),
				);
			} else if (
				request.url === "/api/v1/auth/validate" ||
				request.url === "/api/v0/meta/db"
			) {
				response.end("{}");
			} else if (request.url === "/api/v1/iam/me") {
				response.end(
					JSON.stringify({
						principal: {
							principal_id: 1,
							name: "admin",
							identity_scope: "local",
						},
					}),
				);
			} else {
				response.statusCode = 404;
				response.end("{}");
			}
		};
		server = createServer(handler);
		secondServer = createServer(handler);
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing fixture server address");
		origin = `http://127.0.0.1:${address.port}`;
		await new Promise<void>((resolve) =>
			secondServer.listen(0, "127.0.0.1", resolve),
		);
		secondOrigin = `http://127.0.0.1:${(secondServer.address() as { port: number }).port}`;
	});
	test.afterAll(async () => {
		await Promise.all(
			[server, secondServer].map(
				(fixture) =>
					new Promise<void>((resolve, reject) =>
						fixture?.close((error) => (error ? reject(error) : resolve())),
					),
			),
		);
	});

	test("checks compatibility, saves once, and sends every browser to the shared backend", async ({
		page,
		browser,
		request,
	}) => {
		await page.goto("/");
		await expect(page).toHaveURL(/\/setup$/);
		const valkey = new Redis(process.env.VALKEY_URL as string);
		const setupKey = await valkey.get(
			`${process.env.SETTINGS_PREFIX}installation:setup-key`,
		);
		await valkey.quit();
		expect(
			typeof setupKey === "string" && /^[a-f0-9]{64}$/.test(setupKey),
		).toBe(true);
		await expect(
			page.getByRole("heading", { name: "Connect your server" }),
		).toBeVisible();
		const probe = await request.get("/readyz");
		expect(probe.status()).toBe(200);
		expect((await probe.json()).status).toBe("setup_required");
		for (const [width, theme] of [
			[390, "light"],
			[1280, "dark"],
		] as const) {
			await page.setViewportSize({ width, height: 900 });
			await page.evaluate(
				(theme) => localStorage.setItem("hubuum.theme", theme),
				theme,
			);
			await page.reload();
			await page.evaluate(async () => {
				await document.fonts.ready;
			});
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
			expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
			await page.screenshot({
				path: test.info().outputPath(`setup-${theme}.png`),
				fullPage: true,
			});
		}
		await page.getByLabel("Server URL").fill(origin);
		await page.getByLabel("Setup key", { exact: true }).fill(setupKey ?? "");
		await page.getByRole("button", { name: "Check connection" }).click();
		const setupError = page
			.getByRole("form", { name: "Backend setup" })
			.getByRole("alert");
		await expect(
			page.getByText("Compatibility not verified", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Save and continue anyway" }),
		).toBeDisabled();
		version = "0.0.22";
		identified = false;
		await page.getByLabel("Server URL").fill(`${origin}/`);
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(setupError).toContainText("recognizable Hubuum API");
		identified = true;
		ready = false;
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(setupError).toContainText("not ready");
		ready = true;
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(page.getByText("Compatible server found")).toBeVisible();
		// A check alone must not configure the installation for another browser.
		const other = await browser.newContext();
		const otherPage = await other.newPage();
		await otherPage.goto("/login");
		await expect(otherPage).toHaveURL(/\/setup$/);
		// Editing a checked URL invalidates the previous result.
		await page.getByLabel("Server URL").fill(origin);
		await expect(
			page.getByRole("button", { name: "Save and continue" }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(page.getByText("Compatible server found")).toBeVisible();
		version = "0.0.19-patched";
		await page
			.getByRole("button", { name: "Save and continue", exact: true })
			.click();
		await expect(
			page.getByText("Known compatibility problems", { exact: true }),
		).toBeVisible();
		await expect(page.getByRole("checkbox")).not.toBeChecked();
		await expect(
			page.getByRole("button", { name: "Save and continue anyway" }),
		).toBeDisabled();
		await page.getByRole("checkbox").check();
		await page
			.getByRole("button", { name: "Save and continue anyway" })
			.click();
		await expect(page).toHaveURL(/\/login$/);
		await expect(
			page.getByRole("heading", { name: "Sign in to Hubuum" }),
		).toBeVisible();
		await expect.poll(() => providerRequests).toBeGreaterThan(0);
		await otherPage.goto("/setup");
		await expect(otherPage).toHaveURL(/\/login$/);
		const again = await request.post("/_hubuum-bff/setup", {
			headers: {
				origin: new URL(page.url()).origin,
				"x-hubuum-setup-key": setupKey ?? "",
			},
			data: { action: "save", url: origin },
		});
		expect(again.status()).toBe(409);
		expect((await (await request.get("/readyz")).json()).status).toBe("ready");

		// Use real BFF sessions against both fixture origins, including a stale browser.
		const login = async (client: typeof page.request) => {
			const result = await client.post("/_hubuum-bff/auth/login", {
				headers: { origin: new URL(page.url()).origin },
				data: { username: "admin", password: "fixture-password" },
			});
			expect(result.status()).toBe(200);
		};
		await login(page.request);
		await login(otherPage.request);
		await page.goto("/admin/configuration");
		await expect(
			page.getByRole("tab", { name: /^Effective configuration/ }),
		).toHaveAttribute("aria-selected", "true");
		await page.getByRole("tab", { name: /^Connection/ }).click();
		await expect(
			page.getByText(`Current server: ${origin}`, { exact: true }),
		).toBeVisible();
		await expect(page.getByLabel("Setup key", { exact: true })).toHaveCount(0);
		await page.getByLabel("Server URL").fill(secondOrigin);
		version = "0.0.22";
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(page.getByText("Compatible server found")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Switch server and sign out" }),
		).toBeDisabled();
		await expect.poll(() => misdirectedCredentials).toBe(0);
		await page.setViewportSize({ width: 390, height: 900 });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(
			(
				await new AxeBuilder({ page })
					.include('[aria-label="Frontend server connection"]')
					.analyze()
			).violations,
		).toEqual([]);
		await page.screenshot({
			path: test.info().outputPath("connection-mobile.png"),
			fullPage: true,
		});
		await page.getByRole("checkbox").check();
		await page
			.getByRole("button", { name: "Switch server and sign out" })
			.click();
		await expect(page).toHaveURL(/\/login$/);
		expect(
			(await otherPage.request.get("/_hubuum-bff/connection")).status(),
		).toBe(401);
		await login(page.request);
		await page.goto("/admin/configuration");
		await page.getByRole("tab", { name: /^Connection/ }).click();
		await expect(
			page.getByText(`Current server: ${secondOrigin}`, { exact: true }),
		).toBeVisible();
		expect(misdirectedCredentials).toBe(0);
		await other.close();
	});
});
