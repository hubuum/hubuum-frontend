import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
	buildPerformanceReport,
	evaluatePerformanceBudgets,
	formatBytes,
	readPerformanceBudgetConfig,
	renderPerformanceSummary,
} from "./check-performance-budgets.mjs";

const temporaryDirectories = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { force: true, recursive: true }),
		),
	);
});

async function createFixture() {
	const root = await mkdtemp(join(tmpdir(), "hubuum-performance-"));
	temporaryDirectories.push(root);
	const buildDir = join(root, ".next");
	const chunksDir = join(buildDir, "static", "chunks");
	await mkdir(chunksDir, { recursive: true });
	await writeFile(
		join(chunksDir, "shared.js"),
		Array.from({ length: 256 }, (_, index) => `const s${index}=${index};`).join(
			"\n",
		),
	);
	await writeFile(
		join(chunksDir, "route.js"),
		Array.from(
			{ length: 192 },
			(_, index) => `export const r${index}="route-${index}";`,
		).join("\n"),
	);
	await writeFile(
		join(buildDir, "build-manifest.json"),
		JSON.stringify({
			pages: {
				"/_app": ["static/chunks/shared.js"],
				"/login": ["static/chunks/route.js"],
			},
			rootMainFiles: ["static/chunks/shared.js"],
		}),
	);
	await writeFile(
		join(buildDir, "app-build-manifest.json"),
		JSON.stringify({
			pages: {
				"/app/page": ["static/chunks/route.js"],
			},
		}),
	);
	return { buildDir, root };
}

describe("performance budget reporting", () => {
	it("collects static assets and de-duplicates shared route files", async () => {
		const { buildDir } = await createFixture();
		const report = await buildPerformanceReport(buildDir);

		assert.equal(report.assets.length, 2);
		assert.equal(report.routes.length, 3);
		const login = report.routes.find((route) => route.route === "pages:/login");
		const app = report.routes.find((route) => route.route === "app:/app/page");
		assert.deepEqual(login?.files, [
			"static/chunks/route.js",
			"static/chunks/shared.js",
		]);
		assert.deepEqual(app?.files, [
			"static/chunks/route.js",
			"static/chunks/shared.js",
		]);
		assert.equal(report.totalGzipBytes > 0, true);
	});

	it("reports chunk, route, and total budget failures", async () => {
		const { buildDir } = await createFixture();
		const report = await buildPerformanceReport(buildDir);
		const failures = evaluatePerformanceBudgets(report, {
			maxChunkGzipBytes: 1,
			maxRouteGzipBytes: 1,
			maxTotalGzipBytes: 1,
		});

		assert.equal(
			failures.some((failure) => failure.label === "Total static JavaScript"),
			true,
		);
		assert.equal(
			failures.some((failure) => failure.label.startsWith("Chunk ")),
			true,
		);
		assert.equal(
			failures.some((failure) => failure.label.startsWith("Route ")),
			true,
		);
	});

	it("loads validated configuration and renders an actionable summary", async () => {
		const { buildDir, root } = await createFixture();
		const configPath = join(root, "performance-budgets.json");
		await writeFile(
			configPath,
			JSON.stringify({
				version: 1,
				maxChunkGzipBytes: 100_000,
				maxRouteGzipBytes: 200_000,
				maxTotalGzipBytes: 300_000,
			}),
		);
		const budgets = await readPerformanceBudgetConfig(configPath);
		const report = await buildPerformanceReport(buildDir);
		const summary = renderPerformanceSummary(report, budgets, []);

		assert.equal(budgets.maxRouteGzipBytes, 200_000);
		assert.match(summary, /Frontend performance budgets: passed/);
		assert.match(summary, /Largest route bundles/);
		assert.equal(formatBytes(1024), "1.0 KiB");
	});

	it("rejects malformed budget configuration", async () => {
		const { root } = await createFixture();
		const configPath = join(root, "performance-budgets.json");
		await writeFile(
			configPath,
			JSON.stringify({
				version: 1,
				maxChunkGzipBytes: 0,
				maxRouteGzipBytes: 1,
				maxTotalGzipBytes: 1,
			}),
		);

		await assert.rejects(
			readPerformanceBudgetConfig(configPath),
			/maxChunkGzipBytes must be a positive integer/,
		);
	});
});
