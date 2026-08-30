#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const exceptionPath = join(projectRoot, "release-dependency-exceptions.json");
const workflowDirectory = join(projectRoot, ".github", "workflows");
const supportedEcosystems = new Set(["npm", "github-actions"]);

function fail(message) {
	throw new Error(message);
}

function commandOutput(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		encoding: "utf8",
		...options,
	});

	if (result.error) {
		fail(`Could not run ${command}: ${result.error.message}`);
	}

	return result;
}

export function parseSemverTag(tag) {
	const match = /^(v?)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(tag);
	if (!match) {
		return null;
	}

	return {
		major: Number(match[2]),
		minor: Number(match[3] ?? 0),
		patch: Number(match[4] ?? 0),
		specificity: 1 + Number(match[3] !== undefined) + Number(match[4] !== undefined),
		tag,
	};
}

function compareSemver(left, right) {
	for (const key of ["major", "minor", "patch"]) {
		if (left[key] !== right[key]) {
			return left[key] - right[key];
		}
	}
	return 0;
}

export function latestStableTag(tags) {
	return tags
		.map((tag) => ({ ...tag, version: parseSemverTag(tag.name) }))
		.filter((tag) => tag.version)
		.sort(
			(left, right) =>
				compareSemver(right.version, left.version) ||
				right.version.specificity - left.version.specificity,
		)[0];
}

export function collectActionPins(workflows) {
	const pins = new Map();
	const errors = [];
	const pinnedUse = /^\s*uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^@\s]+)?@([0-9a-f]{40})\s+#\s*(v?\d+(?:\.\d+){0,2})\s*$/;

	for (const [path, content] of Object.entries(workflows)) {
		for (const [index, line] of content.split("\n").entries()) {
			if (!/^\s*uses:/.test(line) || /^\s*uses:\s+\.\//.test(line)) {
				continue;
			}

			const match = pinnedUse.exec(line);
			if (!match) {
				errors.push(
					`${path}:${index + 1} must pin an external action to a 40-character commit with a stable version comment.`,
				);
				continue;
			}

			const [, dependency, sha, version] = match;
			const key = `${dependency}@${sha}#${version}`;
			const existing = pins.get(key) ?? {
				dependency,
				sha,
				version,
				locations: [],
			};
			existing.locations.push(`${path}:${index + 1}`);
			pins.set(key, existing);
		}
	}

	if (errors.length > 0) {
		fail(errors.join("\n"));
	}

	return [...pins.values()];
}

export function evaluateActionFreshness(pins, tagsByRepository) {
	const stale = [];
	const errors = [];

	for (const pin of pins) {
		const tags = tagsByRepository.get(pin.dependency) ?? [];
		const latest = latestStableTag(tags);
		const pinnedTag = tags.find((tag) => tag.name === pin.version);
		const currentVersion = parseSemverTag(pin.version);

		if (!latest || !currentVersion) {
			errors.push(`No stable action tags were found for ${pin.dependency}.`);
			continue;
		}
		if (!pinnedTag) {
			errors.push(
				`${pin.dependency} uses version comment ${pin.version}, but that tag does not exist.`,
			);
			continue;
		}
		if (pinnedTag.commit.sha !== pin.sha) {
			errors.push(
				`${pin.dependency} ${pin.version} resolves to ${pinnedTag.commit.sha}, not pinned commit ${pin.sha} (${pin.locations.join(", ")}).`,
			);
			continue;
		}

		const comparison = compareSemver(currentVersion, latest.version);
		if (comparison > 0) {
			errors.push(
				`${pin.dependency} pins ${pin.version}, newer than the latest stable tag ${latest.name}.`,
			);
		} else if (comparison < 0) {
			stale.push({
				ecosystem: "github-actions",
				dependency: pin.dependency,
				currentVersion: pin.version,
				targetVersion: latest.name,
				detail: pin.locations.join(", "),
			});
		}
	}

	if (errors.length > 0) {
		fail(errors.join("\n"));
	}

	return stale;
}

export function parseNpmOutdated(output) {
	const trimmed = output.trim();
	if (!trimmed) {
		return [];
	}

	let records;
	try {
		records = JSON.parse(trimmed);
	} catch (error) {
		fail(`npm outdated returned invalid JSON: ${error.message}`);
	}

	return Object.entries(records)
		.filter(
			([, record]) =>
				["dependencies", "devDependencies"].includes(record.type) &&
				record.current !== record.latest,
		)
		.map(([dependency, record]) => ({
			ecosystem: "npm",
			dependency,
			currentVersion: String(record.current),
			targetVersion: String(record.latest),
			detail: record.type,
		}));
}

function validDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function validateExceptions(document, today = new Date().toISOString().slice(0, 10)) {
	if (
		!document ||
		typeof document !== "object" ||
		Array.isArray(document) ||
		!Array.isArray(document.exceptions)
	) {
		fail("release-dependency-exceptions.json must contain an exceptions array.");
	}

	const errors = [];
	const seen = new Set();
	const exceptions = document.exceptions.map((entry, index) => {
		const label = `Exception ${index + 1}`;
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			errors.push(`${label} must be an object.`);
			return entry;
		}

		for (const field of [
			"ecosystem",
			"dependency",
			"currentVersion",
			"targetVersion",
			"reason",
			"trackingIssue",
			"expiresOn",
		]) {
			if (typeof entry[field] !== "string" || !entry[field].trim()) {
				errors.push(`${label} requires a non-empty ${field}.`);
			}
		}

		if (!supportedEcosystems.has(entry.ecosystem)) {
			errors.push(`${label} ecosystem must be npm or github-actions.`);
		}
		if (typeof entry.reason === "string" && entry.reason.trim().length < 20) {
			errors.push(`${label} reason must describe the concrete compatibility constraint.`);
		}
		if (
			typeof entry.trackingIssue === "string" &&
			!/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+$/.test(
				entry.trackingIssue,
			)
		) {
			errors.push(`${label} trackingIssue must be a GitHub issue or pull-request URL.`);
		}
		if (typeof entry.expiresOn === "string") {
			if (!validDate(entry.expiresOn)) {
				errors.push(`${label} expiresOn must be a real YYYY-MM-DD date.`);
			} else if (entry.expiresOn < today) {
				errors.push(`${label} expired on ${entry.expiresOn}.`);
			}
		}
		if (
			entry.pullRequest !== undefined &&
			(!Number.isInteger(entry.pullRequest) || entry.pullRequest < 1)
		) {
			errors.push(`${label} pullRequest must be a positive integer when present.`);
		}

		const key = [
			entry.ecosystem,
			entry.dependency,
			entry.currentVersion,
			entry.targetVersion,
		].join("\0");
		if (seen.has(key)) {
			errors.push(`${label} duplicates another exception.`);
		}
		seen.add(key);
		return entry;
	});

	if (errors.length > 0) {
		fail(errors.join("\n"));
	}

	return exceptions;
}

export function dependabotEcosystem(pullRequest) {
	const branch = pullRequest.head?.ref ?? "";
	if (branch.startsWith("dependabot/npm_and_yarn/")) {
		return "npm";
	}
	if (branch.startsWith("dependabot/github_actions/")) {
		return "github-actions";
	}
	return null;
}

export function assessReleaseDependencies({
	staleDependencies,
	dependabotPullRequests,
	exceptions,
}) {
	const blockers = [];
	const allowed = [];
	const matchedDependencies = new Set();

	for (const stale of staleDependencies) {
		const exceptionIndex = exceptions.findIndex(
			(entry) =>
				entry.ecosystem === stale.ecosystem &&
				entry.dependency === stale.dependency &&
				entry.currentVersion === stale.currentVersion &&
				entry.targetVersion === stale.targetVersion,
		);
		if (exceptionIndex === -1) {
			blockers.push({ kind: "dependency", ...stale });
		} else {
			matchedDependencies.add(exceptionIndex);
			allowed.push({ kind: "dependency", ...stale, exception: exceptions[exceptionIndex] });
		}
	}

	for (const pullRequest of dependabotPullRequests) {
		const ecosystem = dependabotEcosystem(pullRequest);
		const exceptionIndex = exceptions.findIndex(
			(entry) =>
				entry.pullRequest === pullRequest.number &&
				entry.ecosystem === ecosystem,
		);
		if (exceptionIndex === -1) {
			blockers.push({
				kind: "pull-request",
				ecosystem,
				number: pullRequest.number,
				title: pullRequest.title,
				url: pullRequest.html_url,
			});
		} else {
			allowed.push({
				kind: "pull-request",
				ecosystem,
				number: pullRequest.number,
				title: pullRequest.title,
				url: pullRequest.html_url,
				exception: exceptions[exceptionIndex],
			});
		}
	}

	for (const [index, exception] of exceptions.entries()) {
		if (!matchedDependencies.has(index)) {
			blockers.push({ kind: "unused-exception", exception });
		}
	}

	return { allowed, blockers };
}

function readWorkflows() {
	return Object.fromEntries(
		readdirSync(workflowDirectory)
			.filter((name) => /\.ya?ml$/.test(name))
			.map((name) => {
				const path = join(workflowDirectory, name);
				return [relative(projectRoot, path), readFileSync(path, "utf8")];
			}),
	);
}

function ghApi(endpoint) {
	const result = commandOutput("gh", ["api", "--paginate", "--slurp", endpoint]);
	if (result.status !== 0) {
		fail(`GitHub API request failed for ${endpoint}: ${result.stderr.trim()}`);
	}
	const pages = JSON.parse(result.stdout);
	return pages.flat();
}

function repositoryName() {
	if (process.env.GITHUB_REPOSITORY) {
		return process.env.GITHUB_REPOSITORY;
	}
	const result = commandOutput("gh", [
		"repo",
		"view",
		"--json",
		"nameWithOwner",
		"--jq",
		".nameWithOwner",
	]);
	if (result.status !== 0 || !result.stdout.trim()) {
		fail("Set GITHUB_REPOSITORY or authenticate gh for the current repository.");
	}
	return result.stdout.trim();
}

function blockerMessage(blocker) {
	if (blocker.kind === "dependency") {
		return `${blocker.ecosystem} dependency ${blocker.dependency} is ${blocker.currentVersion}; latest is ${blocker.targetVersion} (${blocker.detail}).`;
	}
	if (blocker.kind === "pull-request") {
		return `Dependabot PR #${blocker.number} remains open: ${blocker.title} (${blocker.url}).`;
	}
	const entry = blocker.exception;
	return `Exception for ${entry.ecosystem} ${entry.dependency} ${entry.currentVersion} -> ${entry.targetVersion} matches no current deferral and must be removed.`;
}

function allowedMessage(item) {
	const entry = item.exception;
	const subject =
		item.kind === "dependency"
			? `${item.ecosystem} ${item.dependency} ${item.currentVersion} -> ${item.targetVersion}`
			: `Dependabot PR #${item.number}`;
	return `${subject} is deferred until ${entry.expiresOn}: ${entry.reason} (${entry.trackingIssue}).`;
}

export function runReleaseDependencyGate() {
	const packageDocument = JSON.parse(
		readFileSync(join(projectRoot, "package.json"), "utf8"),
	);
	const exceptionDocument = JSON.parse(readFileSync(exceptionPath, "utf8"));
	const exceptions = validateExceptions(exceptionDocument);
	const pins = collectActionPins(readWorkflows());

	const npmResult = commandOutput("npm", ["outdated", "--json", "--long"]);
	if (![0, 1].includes(npmResult.status)) {
		fail(`npm outdated failed: ${npmResult.stderr.trim()}`);
	}
	const npmStale = parseNpmOutdated(npmResult.stdout);

	const tagsByRepository = new Map();
	for (const dependency of new Set(pins.map((pin) => pin.dependency))) {
		tagsByRepository.set(
			dependency,
			ghApi(`repos/${dependency}/tags?per_page=100`),
		);
	}
	const actionStale = evaluateActionFreshness(pins, tagsByRepository);

	const repository = repositoryName();
	const dependabotPullRequests = ghApi(
		`repos/${repository}/pulls?state=open&per_page=100`,
	).filter((pullRequest) => pullRequest.user?.login === "dependabot[bot]");
	const assessment = assessReleaseDependencies({
		staleDependencies: [...npmStale, ...actionStale],
		dependabotPullRequests,
		exceptions,
	});

	for (const item of assessment.allowed) {
		console.warn(`Allowed release dependency exception: ${allowedMessage(item)}`);
	}
	if (assessment.blockers.length > 0) {
		for (const blocker of assessment.blockers) {
			console.error(`Release dependency blocker: ${blockerMessage(blocker)}`);
		}
		fail(
			"Update or supersede every dependency change, or add an exact, unexpired reviewed exception before tagging.",
		);
	}

	const productionCount = Object.keys(packageDocument.dependencies ?? {}).length;
	const developmentCount = Object.keys(packageDocument.devDependencies ?? {}).length;
	console.log(
		`Release dependency gate passed for ${productionCount} application dependencies, ${developmentCount} development dependencies, ${pins.length} pinned action references, and ${dependabotPullRequests.length} open Dependabot PRs.`,
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	try {
		runReleaseDependencyGate();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
