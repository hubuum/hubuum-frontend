import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
	new URL("./check-release-readiness.sh", import.meta.url),
);
const snapshot = `sha-${"a".repeat(40)}`;
const digest = `sha256:${"b".repeat(64)}`;

for (const [name, serverTag, released, pinned, matches, succeeds] of [
	["released server on main", "v1.2.3", false, true, true, true],
	["released server for a frontend release", "v1.2.3", true, true, true, true],
	["immutable snapshot on main", snapshot, false, true, true, true],
	[
		"snapshot cannot become a frontend release baseline",
		snapshot,
		true,
		true,
		true,
		false,
	],
	["snapshot requires its digest", snapshot, false, false, true, false],
	["snapshot requires a full commit", "sha-abcdef", false, true, true, false],
	[
		"documentation must match the selected snapshot",
		snapshot,
		false,
		true,
		false,
		false,
	],
]) {
	test(name, () => {
		const directory = mkdtempSync(join(tmpdir(), "hubuum-release-readiness-"));
		const image = `ghcr.io/hubuum/hubuum-server:${serverTag}`;
		const label = released ? "`v0.0.1`" : "`main` (unreleased)";
		const files = {
			"package.json": JSON.stringify({ version: "0.0.1" }),
			"package-lock.json": JSON.stringify({
				packages: { "": { version: "0.0.1" } },
			}),
			"charts/hubuum-frontend/Chart.yaml":
				"version: 0.0.1\nappVersion: v0.0.1\n",
			"CHANGELOG.md": "## [0.0.1]\n",
			"compose.quickstart.yml":
				"image: ghcr.io/hubuum/hubuum-frontend:v0.0.1\n",
			".env.quickstart.example":
				"HUBUUM_FRONTEND_IMAGE=ghcr.io/hubuum/hubuum-frontend:v0.0.1\n",
			".github/workflows/ci.yml": `COMPAT_BACKEND_IMAGE: ${image}${pinned ? `@${digest}` : ""}\n`,
			"docs/compatibility.md": matches
				? `| ${label} | \`${serverTag}\` | \`${image}\` |\n`
				: "stale target\n",
		};
		try {
			for (const [path, contents] of Object.entries(files)) {
				mkdirSync(dirname(join(directory, path)), { recursive: true });
				writeFileSync(join(directory, path), contents);
			}
			const result = spawnSync(
				"bash",
				[script, ...(released ? ["v0.0.1"] : [])],
				{
					cwd: directory,
					encoding: "utf8",
				},
			);
			assert.equal(
				result.status === 0,
				succeeds,
				result.stderr || result.stdout,
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}
