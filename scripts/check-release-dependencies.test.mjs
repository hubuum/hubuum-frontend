import assert from "node:assert/strict";
import test from "node:test";

import {
	assessReleaseDependencies,
	collectActionPins,
	evaluateActionFreshness,
	latestStableTag,
	parseNpmOutdated,
	validateExceptions,
} from "./check-release-dependencies.mjs";

const sha1 = "1".repeat(40);
const sha2 = "2".repeat(40);

test("collectActionPins requires immutable refs with stable version comments", () => {
	const pins = collectActionPins({
		".github/workflows/ci.yml": [
			`      uses: actions/checkout@${sha1} # v7.0.1`,
			`    uses: docker/example/.github/workflows/build.yml@${sha2} # v2`,
		].join("\n"),
	});

	assert.deepEqual(
		pins.map(({ dependency, version }) => ({ dependency, version })),
		[
			{ dependency: "actions/checkout", version: "v7.0.1" },
			{ dependency: "docker/example", version: "v2" },
		],
	);
	assert.throws(
		() =>
			collectActionPins({
				".github/workflows/ci.yml": "      uses: actions/checkout@v7",
			}),
		/must pin an external action/,
	);
});

test("latestStableTag ignores prereleases and prefers a precise stable tag", () => {
	const latest = latestStableTag([
		{ name: "v7", commit: { sha: sha1 } },
		{ name: "v7.0.0", commit: { sha: sha1 } },
		{ name: "v7.1.0-beta.1", commit: { sha: sha2 } },
		{ name: "v6.9.0", commit: { sha: sha2 } },
	]);

	assert.equal(latest.name, "v7.0.0");
});

test("evaluateActionFreshness checks both the version and pinned commit", () => {
	const pins = [
		{
			dependency: "actions/example",
			sha: sha1,
			version: "v1.0.0",
			locations: [".github/workflows/ci.yml:1"],
		},
	];
	const tags = new Map([
		[
			"actions/example",
			[
				{ name: "v1.0.0", commit: { sha: sha1 } },
				{ name: "v1.1.0", commit: { sha: sha2 } },
			],
		],
	]);

	assert.deepEqual(evaluateActionFreshness(pins, tags), [
		{
			ecosystem: "github-actions",
			dependency: "actions/example",
			currentVersion: "v1.0.0",
			targetVersion: "v1.1.0",
			detail: ".github/workflows/ci.yml:1",
		},
	]);

	tags.get("actions/example")[0].commit.sha = sha2;
	assert.throws(
		() => evaluateActionFreshness(pins, tags),
		/resolves to .* not pinned commit/,
	);
});

test("parseNpmOutdated reports direct application and development dependencies", () => {
	assert.deepEqual(
		parseNpmOutdated(
			JSON.stringify({
				next: {
					current: "16.0.0",
					latest: "17.0.0",
					type: "dependencies",
				},
				vitest: {
					current: "4.0.0",
					latest: "5.0.0",
					type: "devDependencies",
				},
				transitive: {
					current: "1.0.0",
					latest: "2.0.0",
					type: "optionalDependencies",
				},
			}),
		),
		[
			{
				ecosystem: "npm",
				dependency: "next",
				currentVersion: "16.0.0",
				targetVersion: "17.0.0",
				detail: "dependencies",
			},
			{
				ecosystem: "npm",
				dependency: "vitest",
				currentVersion: "4.0.0",
				targetVersion: "5.0.0",
				detail: "devDependencies",
			},
		],
	);
});

test("validateExceptions requires a concrete, tracked, unexpired deferral", () => {
	const exception = {
		ecosystem: "npm",
		dependency: "next",
		currentVersion: "16.0.0",
		targetVersion: "17.0.0",
		reason: "Next 17 breaks the supported backend adapter contract.",
		trackingIssue: "https://github.com/hubuum/hubuum-frontend/issues/123",
		expiresOn: "2026-10-01",
		pullRequest: 456,
	};

	assert.deepEqual(
		validateExceptions({ exceptions: [exception] }, "2026-09-01"),
		[exception],
	);
	assert.throws(
		() => validateExceptions({ exceptions: [exception] }, "2026-10-02"),
		/expired on 2026-10-01/,
	);
});

test("assessReleaseDependencies permits only exact dependency and PR exceptions", () => {
	const exception = {
		ecosystem: "npm",
		dependency: "next",
		currentVersion: "16.0.0",
		targetVersion: "17.0.0",
		reason: "Next 17 breaks the supported backend adapter contract.",
		trackingIssue: "https://github.com/hubuum/hubuum-frontend/issues/123",
		expiresOn: "2026-10-01",
		pullRequest: 456,
	};
	const assessment = assessReleaseDependencies({
		staleDependencies: [
			{
				ecosystem: "npm",
				dependency: "next",
				currentVersion: "16.0.0",
				targetVersion: "17.0.0",
				detail: "dependencies",
			},
			{
				ecosystem: "github-actions",
				dependency: "actions/checkout",
				currentVersion: "v7.0.0",
				targetVersion: "v8.0.0",
				detail: ".github/workflows/ci.yml:1",
			},
		],
		dependabotPullRequests: [
			{
				number: 456,
				title: "Bump next",
				html_url: "https://github.com/example/repo/pull/456",
				head: { ref: "dependabot/npm_and_yarn/next-17.0.0" },
			},
		],
		exceptions: [exception],
	});

	assert.equal(assessment.allowed.length, 2);
	assert.deepEqual(
		assessment.blockers.map((blocker) => blocker.kind),
		["dependency"],
	);

	const prOnly = assessReleaseDependencies({
		staleDependencies: [],
		dependabotPullRequests: [
			{
				number: 456,
				title: "Bump next",
				html_url: "https://github.com/example/repo/pull/456",
				head: { ref: "dependabot/npm_and_yarn/next-17.0.0" },
			},
		],
		exceptions: [exception],
	});
	assert.deepEqual(
		prOnly.blockers.map((blocker) => blocker.kind),
		["unused-exception"],
	);
});
