import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseServerOptions } from "./server-options.mjs";

const run = promisify(execFile);
const directories = [];
const scriptPath = (name) => fileURLToPath(new URL(name, import.meta.url));

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

test("defaults to localhost:3000 even when the shell exports its machine hostname", () => {
	assert.deepEqual(
		parseServerOptions([], { HOSTNAME: "workstation.example" }),
		{
			help: false,
			port: "3000",
			portSpecified: false,
			listen: "localhost",
			remainingArgs: [],
		},
	);
});

test("flags override PORT and support equals syntax and the wildcard", () => {
	const options = parseServerOptions(["--port=4100", "--listen=*"], {
		PORT: "4000",
	});
	assert.equal(options.port, "4100");
	assert.equal(options.listen, "0.0.0.0");
	assert.equal(parseServerOptions([], { PORT: "4200" }).port, "4200");
});

test("supports existing Next.js aliases and uses the last listen option", () => {
	const options = parseServerOptions(
		["-p4300", "--listen", "*", "-H", "127.0.0.1"],
		{},
	);
	assert.equal(options.port, "4300");
	assert.equal(options.listen, "127.0.0.1");
	assert.equal(
		parseServerOptions(["--hostname=localhost", "--listen=::1"], {}).listen,
		"::1",
	);
});

test("accepts hostnames and IPv4/IPv6 bind addresses", () => {
	for (const address of [
		"localhost",
		"console.example",
		"127.0.0.1",
		"0.0.0.0",
		"::",
		"::1",
	]) {
		assert.equal(parseServerOptions(["--listen", address], {}).listen, address);
	}
	assert.equal(parseServerOptions(["--listen", "[::1]"], {}).listen, "::1");
});

test("rejects invalid and missing values in both launch modes", () => {
	for (const development of [false, true]) {
		for (const value of [
			"",
			"0",
			"-1",
			"65536",
			"4000junk",
			"4.5",
			"NaN",
			"Infinity",
		]) {
			assert.throws(() =>
				parseServerOptions([`--port=${value}`], {}, { development }),
			);
		}
		for (const value of [
			"",
			" ",
			"http://localhost",
			"localhost:3000",
			"--webpack",
		]) {
			assert.throws(() =>
				parseServerOptions([`--listen=${value}`], {}, { development }),
			);
		}
		for (const flag of ["--port", "--listen", "--hostname"]) {
			assert.throws(() => parseServerOptions([flag], {}, { development }));
		}
		assert.throws(() =>
			parseServerOptions([], { PORT: "bad" }, { development }),
		);
	}
});

test("preserves additional development arguments, including the option terminator", () => {
	const args = [
		"--webpack",
		"--listen",
		"*",
		"--experimental-https-key",
		"key.pem",
		"--",
		"app",
	];
	assert.deepEqual(
		parseServerOptions(args, {}, { development: true }).remainingArgs,
		["--webpack", "--experimental-https-key", "key.pem", "--", "app"],
	);
	assert.throws(() => parseServerOptions(["--unexpected"], {}));
	assert.throws(() => parseServerOptions(["extra-argument"], {}));
});

async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "hubuum-server-options-"));
	directories.push(cwd);
	return {
		cwd,
		env: { ...process.env, PORT: "", HOSTNAME: "workstation.example" },
	};
}

test("production help and invalid flags work before a build exists", async () => {
	const setup = await fixture();
	const script = scriptPath("start-standalone.mjs");
	const result = await run(process.execPath, [script, "--help"], setup);
	assert.match(result.stdout, /--listen/);
	assert.match(result.stdout, /localhost/);
	await assert.rejects(
		run(process.execPath, [script, "--port=0"], setup),
		(error) => {
			assert.equal(error.code, 1);
			assert.match(error.stderr, /between 1 and 65535/);
			assert.doesNotMatch(error.stderr, /Missing/);
			return true;
		},
	);
});

test("production forwards bind options to the generated server and still copies assets", async () => {
	const setup = await fixture();
	await mkdir(join(setup.cwd, ".next/standalone"), { recursive: true });
	await mkdir(join(setup.cwd, ".next/static"), { recursive: true });
	await writeFile(join(setup.cwd, ".next/static/asset.txt"), "asset");
	await writeFile(
		join(setup.cwd, ".next/standalone/server.js"),
		"console.log(JSON.stringify({port: process.env.PORT, listen: process.env.HOSTNAME}));",
	);
	const script = scriptPath("start-standalone.mjs");
	for (const [args, expected] of [
		[[], { port: "3000", listen: "localhost" }],
		[["--port", "4400", "--listen", "*"], { port: "4400", listen: "0.0.0.0" }],
		[["--port=4500", "--listen=::1"], { port: "4500", listen: "::1" }],
	]) {
		const result = await run(process.execPath, [script, ...args], setup);
		assert.deepEqual(
			JSON.parse(result.stdout.trim().split("\n").at(-1)),
			expected,
		);
	}
	assert.equal(
		await readFile(
			join(setup.cwd, ".next/standalone/.next/static/asset.txt"),
			"utf8",
		),
		"asset",
	);
});

test("development passes normalized options to Next.js without losing its other flags", async () => {
	const setup = await fixture();
	await mkdir(join(setup.cwd, "scripts"));
	await mkdir(join(setup.cwd, "node_modules/next/dist/bin"), {
		recursive: true,
	});
	for (const name of ["dev-server.mjs", "server-options.mjs"]) {
		await cp(scriptPath(name), join(setup.cwd, "scripts", name));
	}
	await writeFile(
		join(setup.cwd, "node_modules/next/dist/bin/next"),
		"console.log(JSON.stringify(process.argv.slice(2)));",
	);
	const script = join(setup.cwd, "scripts/dev-server.mjs");
	const result = await run(
		process.execPath,
		[script, "--port", "4600", "--listen", "*", "--webpack"],
		setup,
	);
	assert.deepEqual(JSON.parse(result.stdout), [
		"dev",
		"--hostname",
		"0.0.0.0",
		"--port",
		"4600",
		"--webpack",
	]);
	const defaults = await run(process.execPath, [script], setup);
	assert.deepEqual(JSON.parse(defaults.stdout), [
		"dev",
		"--hostname",
		"localhost",
	]);
});
