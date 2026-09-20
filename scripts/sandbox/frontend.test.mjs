import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { command, hash } from "./core.mjs";
import { stopOrphanedFrontend } from "./frontend.mjs";

const state = { name: "default", run: "12345678-1234-1234-1234-123456789abc" };

async function fixture(t) {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "sandbox-frontend-")),
	);
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, ".next/dev"), { recursive: true });
	const lock = JSON.stringify({ pid: 201 });
	await writeFile(join(root, ".next/dev/lock"), lock);
	const parent = {
		pid: 200,
		parent: 1,
		group: 200,
		started: "100",
		cwd: root,
		args: [process.execPath, join(root, "scripts/dev-server.mjs")],
		markers: [
			`SESSION_PREFIX=sandbox:${state.run}:session:`,
			`SETTINGS_PREFIX=sandbox:${state.run}:settings:`,
		],
	};
	const frontend = { ...parent, pid: 201, parent: 200, started: "101" };
	const processes = new Map([
		[200, parent],
		[201, frontend],
	]);
	const signals = [];
	const options = {
		platform: "linux",
		inspect: async (pid) => processes.get(pid) ?? null,
		kill: (pid, signal) => {
			signals.push([pid, signal]);
			processes.clear();
		},
		wait: async () => {},
		timeout: 50,
	};
	return { root, parent, frontend, processes, signals, options, lock };
}

test("orphan shutdown signals only the verified sandbox group and preserves the Next lock", async (t) => {
	const f = await fixture(t);
	await stopOrphanedFrontend(f.root, state, f.options);
	assert.deepEqual(f.signals, [[-200, "SIGTERM"]]);
	assert.equal(await readFile(join(f.root, ".next/dev/lock"), "utf8"), f.lock);
});

test("other sandboxes, ordinary development, and stale PIDs are left alone", async (t) => {
	for (const mode of ["other-run", "ordinary", "other-checkout", "exited"]) {
		const f = await fixture(t);
		if (mode === "other-run")
			f.frontend.markers = ["SESSION_PREFIX=sandbox:other:session:"];
		if (mode === "ordinary") f.frontend.markers = [];
		if (mode === "other-checkout") f.frontend.cwd = join(f.root, "other");
		if (mode === "exited") f.processes.clear();
		await stopOrphanedFrontend(f.root, state, f.options);
		assert.deepEqual(f.signals, [], mode);
	}
});

test("unverifiable ownership and shared process groups prevent shutdown", async (t) => {
	for (const mode of [
		"unknown-parent",
		"wrong-command",
		"shared-group",
		"permission",
	]) {
		const f = await fixture(t);
		if (mode === "unknown-parent") f.processes.delete(200);
		if (mode === "wrong-command")
			f.parent.args = [process.execPath, "/another/script.mjs"];
		if (mode === "shared-group") f.parent.group = f.frontend.group = 99;
		if (mode === "permission")
			f.options.inspect = async () => {
				throw new Error("permission denied");
			};
		await assert.rejects(
			stopOrphanedFrontend(f.root, state, f.options),
			/could not be verified/,
		);
		assert.deepEqual(f.signals, [], mode);
	}
});

test("shutdown waits for both parent and server before allowing cleanup", async (t) => {
	const f = await fixture(t);
	f.options.kill = (pid, signal) => {
		f.signals.push([pid, signal]);
		f.processes.delete(200);
	};
	let waits = 0;
	f.options.wait = async () => {
		waits++;
		f.processes.delete(201);
	};
	await stopOrphanedFrontend(f.root, state, { ...f.options, timeout: 100 });
	assert.equal(waits, 1);
	assert.deepEqual(f.signals, [[-200, "SIGTERM"]]);
});

test("a stubborn owned process is killed after the grace period", async (t) => {
	const f = await fixture(t);
	f.options.kill = (pid, signal) => {
		f.signals.push([pid, signal]);
		if (signal === "SIGKILL") f.processes.clear();
	};
	await stopOrphanedFrontend(f.root, state, f.options);
	assert.deepEqual(f.signals, [
		[-200, "SIGTERM"],
		[-200, "SIGKILL"],
	]);
});

test("PID reuse after SIGTERM never receives SIGKILL", async (t) => {
	const f = await fixture(t);
	f.options.kill = (pid, signal) => {
		f.signals.push([pid, signal]);
		for (const [id, current] of f.processes)
			f.processes.set(id, { ...current, started: "999" });
	};
	await stopOrphanedFrontend(f.root, state, f.options);
	assert.deepEqual(f.signals, [[-200, "SIGTERM"]]);
});

test("failed shutdown refuses dependency cleanup", async (t) => {
	const f = await fixture(t);
	f.options.kill = () => {};
	await assert.rejects(
		stopOrphanedFrontend(f.root, state, f.options),
		/containers and data have been retained/,
	);
});

test("down stops a real orphan group before invoking resource cleanup", {
	skip: process.platform !== "linux",
	timeout: 15000,
}, async (t) => {
	const f = await fixture(t);
	await cp(new URL("../", import.meta.url), join(f.root, "scripts"), {
		recursive: true,
	});
	const worker = `
		const fs = require('node:fs');
		fs.writeFileSync('.next/dev/lock', JSON.stringify({pid: process.pid}));
		process.stdout.write('ready');
		setInterval(() => {}, 1000);
	`;
	await writeFile(
		join(f.root, "scripts/dev-server.mjs"),
		`
		import { spawn } from 'node:child_process';
		const child = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], {stdio: 'inherit'});
		process.on('SIGTERM', () => child.kill('SIGTERM'));
		child.on('exit', () => process.exit(0));
	`,
	);
	const parent = spawn(
		process.execPath,
		[join(f.root, "scripts/dev-server.mjs")],
		{
			cwd: f.root,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				SESSION_PREFIX: `sandbox:${state.run}:session:`,
				SETTINGS_PREFIX: `sandbox:${state.run}:settings:`,
			},
		},
	);
	const exited = once(parent, "exit");
	t.after(async () => {
		try {
			process.kill(-parent.pid, "SIGKILL");
		} catch {
			/* Already stopped. */
		}
		await exited;
	});
	await once(parent.stdout, "data");
	const info = JSON.parse(
		await readFile(join(f.root, ".next/dev/lock"), "utf8"),
	);
	const runtime = join(f.root, "fake-runtime");
	await writeFile(
		runtime,
		`#!${process.execPath}
		const fs = require('node:fs');
		for (const pid of ${JSON.stringify([parent.pid, info.pid])}) {
			try {
				const stat = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
				if (!['Z','X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0])) process.exit(1);
			} catch (error) { if (error.code !== 'ENOENT') throw error; }
		}
		fs.appendFileSync(${JSON.stringify(join(f.root, "cleanup.log"))}, JSON.stringify(process.argv.slice(2)) + '\\n');
	`,
		{ mode: 0o700 },
	);
	const directory = join(f.root, ".local/sandboxes/default");
	await mkdir(directory, { recursive: true });
	const owner = hash(f.root).slice(0, 12);
	await writeFile(
		join(directory, "state.json"),
		JSON.stringify({
			...state,
			version: 1,
			owner,
			project: `hubuum-sandbox-${owner}-default-${state.run.slice(0, 8)}`,
			phase: "preparing",
			runtime,
		}),
	);
	const output = await command(
		process.execPath,
		[join(f.root, "scripts/dev-sandbox.mjs"), "down"],
		{ timeout: 10000, progress: true },
	);
	assert.match(output, /Stopping orphaned frontend/);
	assert.match(output, /Removed default/);
	await assert.rejects(readFile(join(directory, "state.json")), {
		code: "ENOENT",
	});
	const calls = (await readFile(join(f.root, "cleanup.log"), "utf8"))
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(calls.length, 3);
	for (const args of calls)
		assert.ok(args.includes(`label=io.hubuum.sandbox.run=${state.run}`));
});
