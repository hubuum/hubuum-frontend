#!/usr/bin/env node

import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_BUILD_DIR = ".next";
const DEFAULT_CONFIG_PATH = "performance-budgets.json";
const TOP_RESULT_COUNT = 12;
const CLIENT_REFERENCE_MANIFEST_SUFFIX = "_client-reference-manifest.js";

function normalizePath(value) {
	return value.split(sep).join("/").replace(/^\.\//, "");
}

function canonicalAssetPath(value) {
	let normalized = normalizePath(value).replace(/^\/+/, "");
	if (normalized.startsWith("_next/")) {
		normalized = normalized.slice("_next/".length);
	}
	if (normalized.startsWith("chunks/")) {
		normalized = `static/${normalized}`;
	}
	if (normalized.startsWith("app/") || normalized.startsWith("pages/")) {
		normalized = `static/chunks/${normalized}`;
	}
	return normalized;
}

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function walkFiles(directory, predicate) {
	if (!(await pathExists(directory))) {
		return [];
	}

	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkFiles(path, predicate)));
		} else if (entry.isFile() && predicate(entry.name)) {
			files.push(path);
		}
	}
	return files;
}

async function walkJavaScriptFiles(directory) {
	return walkFiles(directory, (name) => name.endsWith(".js"));
}

function positiveInteger(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return value;
}

export async function readPerformanceBudgetConfig(path) {
	const parsed = JSON.parse(await readFile(path, "utf8"));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Performance budget configuration must be an object.");
	}
	if (parsed.version !== 1) {
		throw new Error("Performance budget configuration version must be 1.");
	}

	return {
		maxChunkGzipBytes: positiveInteger(
			parsed.maxChunkGzipBytes,
			"maxChunkGzipBytes",
		),
		maxRouteGzipBytes: positiveInteger(
			parsed.maxRouteGzipBytes,
			"maxRouteGzipBytes",
		),
		maxTotalGzipBytes: positiveInteger(
			parsed.maxTotalGzipBytes,
			"maxTotalGzipBytes",
		),
	};
}

async function readJsonIfPresent(path) {
	if (!(await pathExists(path))) {
		return null;
	}
	return JSON.parse(await readFile(path, "utf8"));
}

function addRouteFiles(routeFiles, route, files) {
	if (!Array.isArray(files)) {
		return;
	}
	const target = routeFiles.get(route) ?? new Set();
	for (const file of files) {
		if (typeof file === "string" && file.endsWith(".js")) {
			target.add(canonicalAssetPath(file));
		}
	}
	if (target.size > 0) {
		routeFiles.set(route, target);
	}
}

function manifestPages(manifest) {
	if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
		return null;
	}
	if (
		manifest.pages &&
		typeof manifest.pages === "object" &&
		!Array.isArray(manifest.pages)
	) {
		return manifest.pages;
	}
	return null;
}

function routeFromClientReferenceManifest(appServerDir, manifestPath) {
	const relativePath = normalizePath(relative(appServerDir, manifestPath));
	const withoutSuffix = relativePath.slice(
		0,
		-CLIENT_REFERENCE_MANIFEST_SUFFIX.length,
	);
	if (withoutSuffix === "route" || withoutSuffix.endsWith("/route")) {
		return null;
	}
	const withoutTerminalPage =
		withoutSuffix === "page" ? "" : withoutSuffix.replace(/\/page$/, "");
	return withoutTerminalPage ? `app:${withoutTerminalPage}` : "app:/";
}

function extractClientReferenceAssets(source) {
	const matches = source.match(
		/(?:\/?_next\/)?static\/chunks\/[^"'\\\s]+\.js|(?:app|pages)\/[^"'\\\s]+\.js/g,
	);
	return matches ? Array.from(new Set(matches.map(canonicalAssetPath))) : [];
}

async function collectClientReferenceRoutes(
	buildDir,
	sharedFiles,
	routeFiles,
) {
	const appServerDir = join(buildDir, "server", "app");
	const manifests = await walkFiles(appServerDir, (name) =>
		name.endsWith(CLIENT_REFERENCE_MANIFEST_SUFFIX),
	);
	for (const manifestPath of manifests) {
		const route = routeFromClientReferenceManifest(
			appServerDir,
			manifestPath,
		);
		if (!route) {
			continue;
		}
		const source = await readFile(manifestPath, "utf8");
		addRouteFiles(
			routeFiles,
			route,
			[...sharedFiles, ...extractClientReferenceAssets(source)],
		);
	}
}

async function collectRouteFiles(buildDir) {
	const routeFiles = new Map();
	const buildManifest = await readJsonIfPresent(
		join(buildDir, "build-manifest.json"),
	);
	const sharedFiles = new Set();
	if (buildManifest && typeof buildManifest === "object") {
		for (const file of buildManifest.rootMainFiles ?? []) {
			if (typeof file === "string" && file.endsWith(".js")) {
				sharedFiles.add(canonicalAssetPath(file));
			}
		}

		const pages = manifestPages(buildManifest);
		if (pages) {
			const appFiles = Array.isArray(pages["/_app"])
				? pages["/_app"]
				: [];
			for (const [route, files] of Object.entries(pages)) {
				addRouteFiles(routeFiles, `pages:${route}`, [
					...(route === "/_app" ? [] : appFiles),
					...(Array.isArray(files) ? files : []),
				]);
			}
		}
	}

	for (const manifestPath of [
		join(buildDir, "app-build-manifest.json"),
		join(buildDir, "server", "app-build-manifest.json"),
	]) {
		const appManifest = await readJsonIfPresent(manifestPath);
		const pages = manifestPages(appManifest);
		if (!pages) {
			continue;
		}
		for (const [route, files] of Object.entries(pages)) {
			addRouteFiles(routeFiles, `app:${route}`, [
				...sharedFiles,
				...(Array.isArray(files) ? files : []),
			]);
		}
	}

	await collectClientReferenceRoutes(buildDir, sharedFiles, routeFiles);
	return routeFiles;
}

export async function buildPerformanceReport(buildDirectory) {
	const buildDir = resolve(buildDirectory);
	const staticDir = join(buildDir, "static");
	if (!(await pathExists(staticDir))) {
		throw new Error(
			`Next.js static output was not found at ${normalizePath(staticDir)}. Run next build first.`,
		);
	}

	const assetPaths = await walkJavaScriptFiles(staticDir);
	if (assetPaths.length === 0) {
		throw new Error("The Next.js build did not contain any static JavaScript.");
	}

	const assets = [];
	const assetByPath = new Map();
	for (const path of assetPaths) {
		const contents = await readFile(path);
		const asset = {
			file: normalizePath(relative(buildDir, path)),
			gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
			rawBytes: contents.byteLength,
		};
		assets.push(asset);
		assetByPath.set(asset.file, asset);
	}
	assets.sort((left, right) => right.gzipBytes - left.gzipBytes);

	const routeFiles = await collectRouteFiles(buildDir);
	const routes = [];
	for (const [route, files] of routeFiles) {
		const missingAssets = Array.from(files).filter(
			(file) => !assetByPath.has(file),
		);
		if (missingAssets.length > 0) {
			throw new Error(
				`Route ${route} references JavaScript not found in the build output: ${missingAssets.join(
					", ",
				)}.`,
			);
		}
		const resolvedAssets = Array.from(files)
			.map((file) => assetByPath.get(file))
			.filter(Boolean);
		if (resolvedAssets.length === 0) {
			continue;
		}
		routes.push({
			files: resolvedAssets.map((asset) => asset.file).sort(),
			gzipBytes: resolvedAssets.reduce(
				(total, asset) => total + asset.gzipBytes,
				0,
			),
			rawBytes: resolvedAssets.reduce(
				(total, asset) => total + asset.rawBytes,
				0,
			),
			route,
		});
	}
	routes.sort((left, right) => right.gzipBytes - left.gzipBytes);

	if (routes.length === 0) {
		throw new Error(
			"No route JavaScript could be resolved from Next.js manifests or App Router client-reference manifests.",
		);
	}

	return {
		assets,
		routes,
		totalGzipBytes: assets.reduce(
			(total, asset) => total + asset.gzipBytes,
			0,
		),
		totalRawBytes: assets.reduce((total, asset) => total + asset.rawBytes, 0),
	};
}

export function evaluatePerformanceBudgets(report, budgets) {
	const failures = [];
	if (report.totalGzipBytes > budgets.maxTotalGzipBytes) {
		failures.push({
			actual: report.totalGzipBytes,
			budget: budgets.maxTotalGzipBytes,
			label: "Total static JavaScript",
		});
	}

	for (const asset of report.assets) {
		if (asset.gzipBytes > budgets.maxChunkGzipBytes) {
			failures.push({
				actual: asset.gzipBytes,
				budget: budgets.maxChunkGzipBytes,
				label: `Chunk ${asset.file}`,
			});
		}
	}

	for (const route of report.routes) {
		if (route.gzipBytes > budgets.maxRouteGzipBytes) {
			failures.push({
				actual: route.gzipBytes,
				budget: budgets.maxRouteGzipBytes,
				label: `Route ${route.route}`,
			});
		}
	}

	return failures.sort((left, right) => right.actual - left.actual);
}

export function formatBytes(bytes) {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KiB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function markdownTable(rows) {
	return [
		"| Name | gzip | raw |",
		"| --- | ---: | ---: |",
		...rows.map(
			(row) =>
				`| \`${row.name.replaceAll("|", "\\|")}\` | ${formatBytes(row.gzipBytes)} | ${formatBytes(row.rawBytes)} |`,
		),
	].join("\n");
}

export function renderPerformanceSummary(report, budgets, failures) {
	const largestChunk = report.assets[0];
	const largestRoute = report.routes[0];
	const status = failures.length === 0 ? "passed" : "failed";
	return [
		`## Frontend performance budgets: ${status}`,
		"",
		"| Budget | Actual | Limit |",
		"| --- | ---: | ---: |",
		`| Total static JavaScript | ${formatBytes(report.totalGzipBytes)} | ${formatBytes(budgets.maxTotalGzipBytes)} |`,
		`| Largest JavaScript chunk | ${formatBytes(largestChunk.gzipBytes)} | ${formatBytes(budgets.maxChunkGzipBytes)} |`,
		`| Largest initial route bundle | ${formatBytes(largestRoute.gzipBytes)} | ${formatBytes(budgets.maxRouteGzipBytes)} |`,
		"",
		"### Largest chunks",
		"",
		markdownTable(
			report.assets.slice(0, TOP_RESULT_COUNT).map((asset) => ({
				gzipBytes: asset.gzipBytes,
				name: asset.file,
				rawBytes: asset.rawBytes,
			})),
		),
		"",
		"### Largest route bundles",
		"",
		markdownTable(
			report.routes.slice(0, TOP_RESULT_COUNT).map((route) => ({
				gzipBytes: route.gzipBytes,
				name: route.route,
				rawBytes: route.rawBytes,
			})),
		),
		...(failures.length === 0
			? []
			: [
					"",
					"### Budget failures",
					"",
					...failures.map(
						(failure) =>
							`- ${failure.label}: ${formatBytes(failure.actual)} exceeds ${formatBytes(failure.budget)}.`,
					),
				]),
		"",
	].join("\n");
}

async function main() {
	const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const buildDir = resolve(
		rootDir,
		process.env.PERFORMANCE_BUILD_DIR ?? DEFAULT_BUILD_DIR,
	);
	const configPath = resolve(
		rootDir,
		process.env.PERFORMANCE_BUDGET_CONFIG ?? DEFAULT_CONFIG_PATH,
	);
	const budgets = await readPerformanceBudgetConfig(configPath);
	const report = await buildPerformanceReport(buildDir);
	const failures = evaluatePerformanceBudgets(report, budgets);
	const summary = renderPerformanceSummary(report, budgets, failures);
	console.log(summary);

	if (process.env.GITHUB_STEP_SUMMARY) {
		await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
	}

	if (failures.length > 0) {
		process.exitCode = 1;
	}
}

const invokedPath = process.argv[1]
	? pathToFileURL(resolve(process.argv[1])).href
	: null;
if (invokedPath === import.meta.url) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
