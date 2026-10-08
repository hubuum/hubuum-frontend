import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../run.sh", import.meta.url));

for (const [mode, signal, expectedCode, address = "127.0.0.1:46379"] of [
	["exit", null, 0],
	["exit", null, 0, "46379"],
	["exit", null, 1, "invalid"],
	["start-fails", null, 17],
	["frontend-fails", null, 23],
	["frontend", "SIGINT", 130],
	["frontend", "SIGTERM", 143],
	["startup", "SIGINT", 130],
]) {
	test(`run.sh cleans its own services: ${mode} ${signal ?? address}`, {
		timeout: 15000,
	}, async (t) => {
		const directory = await mkdtemp(join(tmpdir(), "hubuum-run-test-"));
		const log = join(directory, "calls.jsonl");
		const ready = join(directory, "ready.json");
		await writeFile(log, "");
		await writeFile(
			join(directory, "runtime"),
			`#!${process.execPath}
process.stdout.write(${JSON.stringify(`${address}\n`)});
`,
			{ mode: 0o755 },
		);
		await writeFile(
			join(directory, "npm"),
			`#!${process.execPath}
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const command = args[1];
const mode = process.env.RUN_TEST_MODE;
fs.appendFileSync(process.env.RUN_TEST_LOG, JSON.stringify({
  command, args, project: process.env.HUBUUM_VALKEY_PROJECT,
  backend: process.env.BACKEND_BASE_URL, port: process.env.PORT,
  valkey: process.env.VALKEY_URL, valkeyPort: process.env.VALKEY_DEV_PORT,
}) + "\\n");
if (command === "dev:deps:down") process.exit(0);
if (command === "dev:deps" && mode === "start-fails") process.exit(17);
if (command === "dev" && mode === "frontend-fails") process.exit(23);
if (command === "dev" && mode === "exit") process.exit(0);
if ((command === "dev:deps" && mode === "startup") || command === "dev") {
  const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  process.on("SIGTERM", () => {});
  worker.on("exit", () => process.exit(0));
  worker.on("spawn", () => fs.writeFileSync(process.env.RUN_TEST_READY, JSON.stringify([process.pid, worker.pid])));
}
`,
			{ mode: 0o755 },
		);
		const child = spawn(
			"bash",
			[script, "--port", "5555", "--listen", "127.0.0.1"],
			{
				cwd: directory,
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					BACKEND_BASE_URL: "https://backend.example.com",
					PORT: "4444",
					HUBUUM_VALKEY_PROJECT: "developer-owned",
					HUBUUM_CONTAINER_RUNTIME: join(directory, "runtime"),
					VALKEY_URL: "redis://developer-owned:6379/0",
					VALKEY_DEV_PORT: "",
					RUN_TEST_MODE: mode,
					RUN_TEST_LOG: log,
					RUN_TEST_READY: ready,
				},
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const exited = once(child, "close");
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		t.after(async () => {
			child.kill("SIGTERM");
			await exited;
			await rm(directory, { recursive: true, force: true });
		});
		let pids = [];
		if (signal) {
			for (let attempt = 0; attempt < 200; attempt++) {
				try {
					pids = JSON.parse(await readFile(ready, "utf8"));
					break;
				} catch (error) {
					if (error.code !== "ENOENT") throw error;
					await delay(10);
				}
			}
			assert.equal(pids.length, 2, output);
			assert.equal(
				child.exitCode,
				null,
				"wrapper must remain in the foreground",
			);
			child.kill(signal);
		}
		assert.deepEqual(await exited, [expectedCode, null], output);
		for (const pid of pids)
			assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
		const calls = (await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.map(JSON.parse);
		assert.match(calls[0].project, /^hubuum-run-\d+-\d+$/);
		assert.ok(calls.every((call) => call.project === calls[0].project));
		assert.equal(calls[0].valkeyPort, "");
		assert.deepEqual(calls.at(-1).args, [
			"run",
			"dev:deps:down",
			"--",
			"--volumes",
			"--remove-orphans",
		]);
		const frontend = calls.find((call) => call.command === "dev");
		if (frontend) {
			assert.deepEqual(frontend.args, [
				"run",
				"dev",
				"--",
				"--port",
				"5555",
				"--listen",
				"127.0.0.1",
			]);
			assert.equal(frontend.backend, "https://backend.example.com");
			assert.equal(frontend.port, "4444");
			assert.equal(frontend.valkey, "redis://127.0.0.1:46379/0");
		}
	});
}
