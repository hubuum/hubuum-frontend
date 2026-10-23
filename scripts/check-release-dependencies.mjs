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
const sharedWorkflowRepository = "hubuum/.github";

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

export function validateNodePins(dockerfile, workflows, releases) {
	const images = [...dockerfile.matchAll(/^FROM(?:\s+--platform=\S+)?\s+node:(\S+)/gim)].map((match) => match[1]);
	const image = images[0];
	const version = /^(\d+\.\d+\.\d+)-[^@]+@sha256:[0-9a-f]{64}$/.exec(image ?? "")?.[1];
	if (!version || images.some((value) => value !== image)) {
		fail("All Docker Node stages must use the same exact version and image digest.");
	}
	if (!Array.isArray(releases)) fail("Node.js returned an invalid release index.");
	const current = parseSemverTag(version);
	const latest = releases
		.filter((release) => typeof release?.lts === "string")
		.map((release) => parseSemverTag(release.version))
		.filter((release) => release?.major === current.major && release.specificity === 3)
		.sort((left, right) => compareSemver(right, left))[0];
	if (!latest) fail(`No LTS releases were found for Node.js ${current.major}.`);
	const target = latest.tag.replace(/^v/, "");
	if (version !== target) {
		fail(`Docker pins Node.js ${version}; update to the latest Node.js ${current.major} LTS release, ${target}.`);
	}
	let count = 0;
	for (const [path, content] of Object.entries(workflows)) {
		for (const [index, line] of content.split("\n").entries()) {
			const match = /^\s*node-version:\s*(.*)$/.exec(line);
			if (!match) continue;
			count++;
			const pin = match[1].split("#")[0].trim().replace(/^["']|["']$/g, "");
			if (pin !== target) fail(`${path}:${index + 1} must pin Node.js ${target}, matching Docker.`);
		}
	}
	if (!count) fail("No CI Node.js version pins were found.");
	return target;
}

export async function verifyNodeImageDigest(dockerfile, request = fetch) {
	const image =
		/^FROM(?:\s+--platform=\S+)?\s+node:([^\s@]+)@(sha256:[0-9a-f]{64})/im.exec(
			dockerfile,
		);
	if (!image) fail("Docker must pin a Node image tag and digest.");
	const [, tag, pinnedDigest] = image;
	const auth = await request(
		"https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull",
		{ signal: AbortSignal.timeout(30_000) },
	);
	if (!auth.ok)
		fail(
			`Could not authorize the public Node image check: HTTP ${auth.status}.`,
		);
	const { token } = await auth.json();
	if (typeof token !== "string" || !token)
		fail("Docker registry returned invalid authorization metadata.");
	const manifest = await request(
		`https://registry-1.docker.io/v2/library/node/manifests/${encodeURIComponent(tag)}`,
		{
			method: "HEAD",
			headers: {
				Authorization: `Bearer ${token}`,
				Accept:
					"application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
			},
			signal: AbortSignal.timeout(30_000),
		},
	);
	if (!manifest.ok)
		fail(`Could not check Node image ${tag}: HTTP ${manifest.status}.`);
	const resolvedDigest = manifest.headers.get("docker-content-digest");
	if (!resolvedDigest || !/^sha256:[0-9a-f]{64}$/.test(resolvedDigest)) {
		fail("Docker registry did not return a valid Node image digest.");
	}
	if (pinnedDigest !== resolvedDigest) {
		fail(
			`Node image ${tag} resolves to ${resolvedDigest}, not pinned digest ${pinnedDigest}. Update the Docker digest.`,
		);
	}
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
	const pinnedUse = /^\s*(?:-\s+)?uses:\s+([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^@\s]+)?@([0-9a-f]{40})\s+#\s*(v?\d+(?:\.\d+){0,2}|main)\s*$/;

	for (const [path, content] of Object.entries(workflows)) {
		for (const [index, line] of content.split("\n").entries()) {
			if (!/^\s*(?:-\s+)?uses:/.test(line) || /^\s*(?:-\s+)?uses:\s+\.\//.test(line)) {
				continue;
			}

			const match = pinnedUse.exec(line);
			if (!match || (match[3] === "main" && match[1] !== sharedWorkflowRepository)) {
				errors.push(
					`${path}:${index + 1} must pin an external action to a 40-character commit with a stable version comment (or main for ${sharedWorkflowRepository}).`,
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
		if (pin.dependency === sharedWorkflowRepository && pin.version === "main") {
			const latest = tags.find((tag) => tag.name === "main");
			if (!/^[0-9a-f]{40}$/.test(latest?.commit?.sha ?? "")) {
				errors.push(`Could not resolve main for ${pin.dependency}.`);
			} else if (pin.sha !== latest.commit.sha) {
				stale.push({
					ecosystem: "github-actions",
					dependency: pin.dependency,
					currentVersion: pin.sha,
					targetVersion: latest.commit.sha,
					detail: pin.locations.join(", "),
				});
			}
			continue;
		}
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
		.filter(([, record]) =>
			["dependencies", "devDependencies"].includes(record.type),
		)
		.flatMap(([dependency, record]) => {
			// A maintenance release can move npm's latest tag behind the installed
			// line. Still require newer versions from either latest or our range.
			const current = parseSemverTag(String(record.current));
			const latest = parseSemverTag(String(record.latest));
			const wanted = parseSemverTag(String(record.wanted));
			const target = latest && wanted && compareSemver(wanted, latest) > 0
				? wanted
				: latest;
			if (current && target && compareSemver(current, target) >= 0) {
				return [];
			}
			if (record.current === record.latest && !target) {
				return [];
			}
			return [{
				ecosystem: "npm",
				dependency,
				currentVersion: String(record.current),
				targetVersion: target?.tag ?? String(record.latest),
				detail: record.type,
			}];
		});
}

export function evaluateGeneratorFreshness(script, latestVersion) {
	const pin = /(?:^|\s)npx\s+--yes\s+orval@(\d+\.\d+\.\d+)(?=\s|$)/.exec(script ?? "");
	if (!pin) fail("gen:api must pin Orval to an exact stable version.");
	if (typeof latestVersion !== "string" || parseSemverTag(latestVersion)?.specificity !== 3) {
		fail("npm returned an invalid stable Orval version.");
	}
	return parseNpmOutdated(JSON.stringify({
		orval: { current: pin[1], wanted: pin[1], latest: latestVersion, type: "devDependencies" },
	})).map((entry) => ({ ...entry, detail: "pinned API generator (gen:api)" }));
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

export async function runReleaseDependencyGate() {
	const packageDocument = JSON.parse(
		readFileSync(join(projectRoot, "package.json"), "utf8"),
	);
	const exceptionDocument = JSON.parse(readFileSync(exceptionPath, "utf8"));
	const exceptions = validateExceptions(exceptionDocument);
	const workflows = readWorkflows();
	const pins = collectActionPins(workflows);
	const nodeResponse = await fetch("https://nodejs.org/dist/index.json", {
		signal: AbortSignal.timeout(30_000),
	});
	if (!nodeResponse.ok) fail(`Could not check Node.js releases: HTTP ${nodeResponse.status}.`);
	const dockerfile = readFileSync(join(projectRoot, "Dockerfile"), "utf8");
	const nodeVersion = validateNodePins(
		dockerfile,
		workflows,
		await nodeResponse.json(),
	);
	await verifyNodeImageDigest(dockerfile);

	const npmResult = commandOutput("npm", ["outdated", "--json", "--long"]);
	if (![0, 1].includes(npmResult.status)) {
		fail(`npm outdated failed: ${npmResult.stderr.trim()}`);
	}
	const npmStale = parseNpmOutdated(npmResult.stdout);
	const generatorResult = commandOutput("npm", ["view", "orval", "version", "--json"]);
	if (generatorResult.status !== 0) {
		fail(`Could not check the API generator version: ${generatorResult.stderr.trim()}`);
	}
	const generatorStale = evaluateGeneratorFreshness(
		packageDocument.scripts?.["gen:api"],
		JSON.parse(generatorResult.stdout),
	);

	const tagsByRepository = new Map();
	for (const dependency of new Set(pins.map((pin) => pin.dependency))) {
		if (dependency === sharedWorkflowRepository) {
			const [commit] = ghApi(`repos/${dependency}/commits/main`);
			tagsByRepository.set(dependency, [{ name: "main", commit: { sha: commit.sha } }]);
			continue;
		}
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
		staleDependencies: [...npmStale, ...generatorStale, ...actionStale],
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
		`Release dependency gate passed for Node.js ${nodeVersion} in Docker and CI, ${productionCount} application dependencies, ${developmentCount} development dependencies, the pinned API generator, ${pins.length} pinned action references, and ${dependabotPullRequests.length} open Dependabot PRs.`,
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	try {
		await runReleaseDependencyGate();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
