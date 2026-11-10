import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ trace: "off", video: "off", screenshot: "off" });

test.describe("installation setup", () => {
	test.skip(
		process.env.E2E_SETUP !== "1",
		"Run with npm run test:e2e:setup and its disposable Valkey.",
	);
	let server: Server;
	let origin: string;
	let version = "0.0.21";
	let ready = true;
	let identified = true;
	let providerRequests = 0;
	const contract = JSON.parse(readFileSync("openapi.json", "utf8"));

	test.beforeAll(async () => {
		server = createServer((request, response) => {
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
			} else {
				response.statusCode = 404;
				response.end("{}");
			}
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing fixture server address");
		origin = `http://127.0.0.1:${address.port}`;
	});
	test.afterAll(async () => {
		await new Promise<void>((resolve, reject) =>
			server?.close((error) => (error ? reject(error) : resolve())),
		);
	});

	test("checks compatibility, saves once, and sends every browser to the shared backend", async ({
		page,
		browser,
		request,
	}) => {
		await page.goto("/");
		await expect(page).toHaveURL(/\/setup$/);
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
		await page
			.getByLabel("Setup key", { exact: true })
			.fill(process.env.SETUP_KEY ?? "");
		await page.getByRole("button", { name: "Check connection" }).click();
		const setupError = page
			.getByRole("form", { name: "Backend setup" })
			.getByRole("alert");
		await expect(setupError).toContainText("0.0.21 is not supported");
		await expect(
			page.getByRole("button", { name: "Save and continue" }),
		).toHaveCount(0);
		version = "0.0.22";
		identified = false;
		await page.getByRole("button", { name: "Check connection" }).click();
		await expect(setupError).toContainText(
			"does not expose a supported Hubuum API",
		);
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
		await page.getByLabel("Server URL").fill(`${origin}/`);
		await expect(
			page.getByRole("button", { name: "Save and continue" }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Check connection" }).click();
		await page.getByRole("button", { name: "Save and continue" }).click();
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
				"x-hubuum-setup-key": process.env.SETUP_KEY ?? "",
			},
			data: { action: "save", url: origin },
		});
		expect(again.status()).toBe(409);
		expect((await (await request.get("/readyz")).json()).status).toBe("ready");
		await other.close();
	});
});
