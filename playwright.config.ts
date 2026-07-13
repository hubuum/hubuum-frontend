import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const localBaseUrl = "http://127.0.0.1:3100";

export default defineConfig({
	testDir: "./tests/e2e",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
	outputDir: "test-results/playwright",
	snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
	use: {
		baseURL: externalBaseUrl ?? localBaseUrl,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	webServer: externalBaseUrl
		? undefined
		: {
				command: "npm run dev",
				url: `${localBaseUrl}/login`,
				reuseExistingServer: !process.env.CI,
				timeout: 120_000,
				env: {
					PORT: "3100",
					BACKEND_BASE_URL:
						process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:9",
					VALKEY_URL: process.env.VALKEY_URL ?? "redis://127.0.0.1:6379/0",
				},
			},
	projects: [
		{
			name: "chromium",
			use: { browserName: "chromium" },
		},
	],
});
