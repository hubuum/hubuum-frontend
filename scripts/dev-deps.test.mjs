import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./dev-deps.sh", import.meta.url));
const directories = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function fixture(mode = "ready") {
	const directory = await mkdtemp(join(tmpdir(), "hubuum-dev-deps-"));
	directories.push(directory);
	const runtime = join(directory, "container-runtime");
	const log = join(directory, "calls.jsonl");
	await writeFile(log, "");
	await writeFile(
		runtime,
		`#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.HUBUUM_TEST_CALLS, JSON.stringify(args) + "\\n");
if (args.includes("--wait")) process.exit(99);
if (args.includes("up") && process.env.HUBUUM_TEST_MODE === "start-fails") process.exit(17);
if (args.includes("exec")) {
  const calls = fs.readFileSync(process.env.HUBUUM_TEST_CALLS, "utf8").trim().split("\\n").map(JSON.parse);
  const attempts = calls.filter(call => call.includes("exec")).length;
  process.stdout.write(process.env.HUBUUM_TEST_MODE === "ready" && attempts >= 3 ? "PONG\\n" : "LOADING\\n");
}
`,
		{ mode: 0o755 },
	);
	await writeFile(join(directory, "sleep"), "#!/bin/sh\nexit 0\n", {
		mode: 0o755,
	});
	return {
		env: {
			...process.env,
			PATH: `${directory}:${process.env.PATH}`,
			HUBUUM_CONTAINER_RUNTIME: runtime,
			HUBUUM_VALKEY_PROJECT: "isolated-test-project",
			HUBUUM_TEST_CALLS: log,
			HUBUUM_TEST_MODE: mode,
		},
		calls: async () =>
			(await readFile(log, "utf8")).trim().split("\n").map(JSON.parse),
	};
}

test("starts without --wait and waits for PONG from the selected project", async () => {
	const setup = await fixture();
	const result = await run("bash", [script, "up", "--force-recreate"], setup);
	assert.match(result.stdout, /Valkey is ready/);
	const calls = await setup.calls();
	assert.deepEqual(calls[0].slice(-5), [
		"-p",
		"isolated-test-project",
		"up",
		"-d",
		"--force-recreate",
	]);
	assert.equal(calls.filter((call) => call.includes("exec")).length, 3);
	assert.deepEqual(calls.at(-1).slice(-5), [
		"exec",
		"-T",
		"valkey",
		"valkey-cli",
		"ping",
	]);
});

test("fails if Valkey never accepts connections", async () => {
	const setup = await fixture("never-ready");
	await assert.rejects(run("bash", [script, "up"], setup), (error) => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /did not become ready/);
		return true;
	});
	assert.equal(
		(await setup.calls()).filter((call) => call.includes("exec")).length,
		30,
	);
});

test("propagates a Compose startup failure without reporting readiness", async () => {
	const setup = await fixture("start-fails");
	await assert.rejects(run("bash", [script, "up"], setup), { code: 17 });
	assert.equal((await setup.calls()).length, 1);
});

test("stops the selected project without running readiness probes", async () => {
	const setup = await fixture();
	await run("bash", [script, "down", "--remove-orphans"], setup);
	const calls = await setup.calls();
	assert.equal(calls.length, 1);
	assert.deepEqual(calls[0].slice(-4), [
		"-p",
		"isolated-test-project",
		"down",
		"--remove-orphans",
	]);
});
