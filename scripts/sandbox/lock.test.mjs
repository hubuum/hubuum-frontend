import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lock } from "./runtime.mjs";

async function fixture(t) {
	const root = await fs.mkdtemp(join(tmpdir(), "sandbox-lock-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const directory = join(root, ".local/sandbox-locks");
	await fs.mkdir(directory, { recursive: true });
	return { root, directory, path: join(directory, "run-default.lock") };
}

const deadPid = 2147483647;
const deadOwner = `${deadPid}-00000000-0000-4000-8000-000000000000`;
const options = {
	probe(pid, signal) {
		if (pid === deadPid)
			throw Object.assign(new Error("exited"), { code: "ESRCH" });
		process.kill(pid, signal);
	},
};

async function seedStale(path, legacy = false) {
	if (legacy) return fs.writeFile(path, String(deadPid));
	await fs.mkdir(path);
	await fs.writeFile(join(path, deadOwner), "");
}

test("same-name locks exclude contenders while other names remain available", async (t) => {
	const { root, directory } = await fixture(t);
	const release = await lock(root, "run-default");
	const releaseOther = await lock(root, "run-other");
	await assert.rejects(lock(root, "run-default"), /Sandbox is busy/);
	await release();
	await releaseOther();
	assert.deepEqual(await fs.readdir(directory), []);
});

test("a repeated release cannot remove a subsequent owner's lock", async (t) => {
	const { root } = await fixture(t);
	const release = await lock(root, "run-default");
	await release();
	const releaseNext = await lock(root, "run-default");
	t.after(releaseNext);
	await release();
	await assert.rejects(lock(root, "run-default"), /Sandbox is busy/);
});

test("stale directories, legacy PID files, and interrupted releases are recoverable", async (t) => {
	for (const mode of ["directory", "legacy", "empty"]) {
		const { root, path } = await fixture(t);
		if (mode === "empty") await fs.mkdir(path);
		else await seedStale(path, mode === "legacy");
		const release = await lock(root, "run-default", options);
		assert.equal((await fs.readdir(path)).length, 1);
		await assert.rejects(lock(root, "run-default", options), /Sandbox is busy/);
		await release();
	}
});

test("live legacy owners and uncertain or invalid ownership fail closed", async (t) => {
	for (const mode of ["live", "invalid-pid", "invalid-marker", "permission"]) {
		const { root, path } = await fixture(t);
		let expected = /Sandbox is busy/;
		if (mode === "invalid-marker") {
			await fs.mkdir(path);
			await fs.writeFile(join(path, "unknown-owner"), "");
			expected = /Invalid sandbox lock/;
		} else {
			await fs.writeFile(
				path,
				mode === "invalid-pid" ? "" : String(process.pid),
			);
			if (mode === "invalid-pid") expected = /Invalid sandbox lock/;
		}
		const settings =
			mode === "permission"
				? {
						probe() {
							throw Object.assign(new Error("denied"), { code: "EPERM" });
						},
					}
				: options;
		await assert.rejects(lock(root, "run-default", settings), expected);
		assert.ok(await fs.lstat(path));
	}
});

for (const legacy of [false, true]) {
	test(`delayed stale recovery preserves the replacement owner (${legacy ? "legacy" : "directory"})`, async (t) => {
		const { root, path } = await fixture(t);
		await seedStale(path, legacy);
		const removing = Promise.withResolvers();
		const proceed = Promise.withResolvers();
		t.after(() => proceed.resolve());
		const target = legacy ? path : join(path, deadOwner);
		const contender = lock(root, "run-default", {
			...options,
			fs: {
				...fs,
				async unlink(file) {
					if (file === target) {
						removing.resolve();
						await proceed.promise;
					}
					return fs.unlink(file);
				},
			},
		});
		const rejected = assert.rejects(contender, /Sandbox is busy/);
		await removing.promise;
		const release = await lock(root, "run-default", options);
		t.after(release);
		const owner = await fs.readdir(path);
		proceed.resolve();
		await rejected;
		assert.deepEqual(await fs.readdir(path), owner);
		await assert.rejects(lock(root, "run-default", options), /Sandbox is busy/);
	});
}

test("a delayed directory removal cannot remove a newly acquired lock", async (t) => {
	const { root, path } = await fixture(t);
	const removing = Promise.withResolvers();
	const proceed = Promise.withResolvers();
	t.after(() => proceed.resolve());
	const release = await lock(root, "run-default", {
		fs: {
			...fs,
			async rmdir(directory) {
				if (directory === path) {
					removing.resolve();
					await proceed.promise;
				}
				return fs.rmdir(directory);
			},
		},
	});
	const released = release();
	await removing.promise;
	const releaseNext = await lock(root, "run-default");
	t.after(releaseNext);
	proceed.resolve();
	await released;
	await assert.rejects(lock(root, "run-default"), /Sandbox is busy/);
});

test("failed preparation cleans up its private claim without publishing a lock", async (t) => {
	const { root, directory } = await fixture(t);
	await assert.rejects(
		lock(root, "run-default", {
			fs: {
				...fs,
				async writeFile() {
					throw new Error("write failed");
				},
			},
		}),
		/write failed/,
	);
	assert.deepEqual(await fs.readdir(directory), []);
});

async function contender(t, root) {
	const source = `
		import { lock } from ${JSON.stringify(new URL("./lock.mjs", import.meta.url).href)};
		const start = new Promise(resolve => process.once('message', resolve));
		process.send('ready');
		await start;
		try {
			const release = await lock(process.argv[1], 'run-default');
			const stop = new Promise(resolve => process.once('message', resolve));
			process.send('acquired');
			await stop;
			await release();
		} catch (error) {
			process.send(error.message.includes('Sandbox is busy') ? 'busy' : error.message);
		}
		process.disconnect();
	`;
	const child = spawn(
		process.execPath,
		["--input-type=module", "-e", source, root],
		{
			stdio: ["ignore", "ignore", "pipe", "ipc"],
		},
	);
	const closed = once(child, "close");
	t.after(async () => {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		await closed;
	});
	assert.deepEqual(await once(child, "message"), ["ready", undefined]);
	return {
		child,
		closed,
		async start() {
			const response = once(child, "message");
			child.send("start");
			return (await response)[0];
		},
	};
}

test("competing processes recover a crashed owner with exactly one winner", {
	timeout: 10000,
}, async (t) => {
	const { root, directory } = await fixture(t);
	const first = await contender(t, root);
	assert.equal(await first.start(), "acquired");
	first.child.kill("SIGKILL");
	await first.closed;
	const contenders = await Promise.all([
		contender(t, root),
		contender(t, root),
	]);
	const results = await Promise.all(contenders.map((item) => item.start()));
	assert.deepEqual([...results].sort(), ["acquired", "busy"]);
	const winner = contenders[results.indexOf("acquired")];
	await assert.rejects(lock(root, "run-default"), /Sandbox is busy/);
	winner.child.send("release");
	await Promise.all(contenders.map((item) => item.closed));
	assert.deepEqual(await fs.readdir(directory), []);
});
