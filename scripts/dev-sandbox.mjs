import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
	apiClient,
	passwordInput,
	setPassword,
	verifyCorpus,
	waitFor,
	withAdmin,
} from "./sandbox/auth.mjs";
import { parseOptions } from "./sandbox/core.mjs";
import {
	checkPort,
	checkDevelopmentProcess,
	frontendEnvironment,
	lock,
	Sandbox,
} from "./sandbox/runtime.mjs";
import { obtainTarget, snapshotCompose } from "./sandbox/target.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function help() {
	console.info(`Usage: npm run dev:sandbox -- [start] <selector> [options]
       npm run dev:sandbox -- resume|status|down|password [options]

Selectors (choose one for start):
  --tag <tag>           Published server tag, e.g. main
  --sha <commit>        Full Git SHA or unambiguous prefix (7+ characters)
  --pr <number|URL>     Hubuum PR head, or merge commit for a merged PR
  --image <reference>   ghcr.io/hubuum/hubuum-server@sha256:<digest>

Options:
  --name <name>         Sandbox name (default: default)
  --corpus <name>       Server corpus (currently comprehensive)
  --keep               Retain containers and data after exit
  --no-frontend        Start dependencies only; requires --keep for start
  --no-build           Do not build unpublished SHA/PR targets locally
  --port, -p <port>     Frontend port (default: PORT or 3000)
  --listen <address>    Frontend bind address (default: 127.0.0.1)
  --user <username>     Account to provision/reset (default: corpus-admin)
  --password-stdin      Read a chosen password from stdin instead of prompting
  --help, -h           Show help

Fresh interactive starts prompt for a corpus-admin password. A dependency-only
start can defer passwords until 'password --user <name>'. Passwords are never
printed or saved to files. See docs/local-sandbox.md for accounts and examples.`);
}

function summary(state) {
	console.info(`[sandbox] ${state.name}: ${state.phase}`);
	if (state.image)
		console.info(
			`[sandbox] Image: ${state.image.ref}\n[sandbox] Source: ${state.revision}`,
		);
	if (state.corpus)
		console.info(
			`[sandbox] Corpus: ${state.corpus.name}, recipe ${state.corpus.recipe_revision}, ${state.corpus.state_counts.objects} objects\n[sandbox] Corpus SHA-256: ${state.corpus.sha256}`,
		);
	if (state.backendPort)
		console.info(`[sandbox] Backend: http://127.0.0.1:${state.backendPort}`);
	console.info(
		`[sandbox] Set a password: npm run dev:sandbox -- password --name ${state.name} --user corpus-admin`,
	);
	console.info(
		`[sandbox] Cleanup: npm run dev:sandbox -- down --name ${state.name}`,
	);
}

async function launchFrontend(state, options, signal) {
	const address = options.server.listen.includes(":")
		? `[${options.server.listen}]`
		: options.server.listen;
	console.info(`[sandbox] Frontend: http://${address}:${options.server.port}`);
	await new Promise((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[
				join(ROOT, "scripts/dev-server.mjs"),
				"--port",
				options.server.port,
				"--listen",
				options.server.listen,
			],
			{
				cwd: ROOT,
				env: frontendEnvironment(state),
				stdio: "inherit",
				detached: process.platform !== "win32",
			},
		);
		let timer;
		const kill = (kind) => {
			try {
				if (process.platform === "win32") child.kill(kind);
				else if (child.pid) process.kill(-child.pid, kind);
			} catch {
				/* Already exited. */
			}
		};
		const stop = () => {
			kill("SIGTERM");
			timer = setTimeout(() => kill("SIGKILL"), 5000);
		};
		signal.addEventListener("abort", stop, { once: true });
		child.once("error", () => {
			signal.removeEventListener("abort", stop);
			reject(new Error("Could not start the frontend."));
		});
		child.once("close", (code) => {
			signal.removeEventListener("abort", stop);
			clearTimeout(timer);
			if (signal.aborted || code === 0) resolve();
			else reject(new Error(`Frontend exited with status ${code}.`));
		});
		if (signal.aborted) stop();
	});
}

async function clean(sandbox) {
	const unlock = await lock(ROOT, `password-${sandbox.name}`);
	try {
		await sandbox.cleanup();
		console.info(`[sandbox] Removed ${sandbox.name}.`);
	} finally {
		await unlock();
	}
}

export async function main(args = process.argv.slice(2)) {
	const options = parseOptions(args);
	if (options.help) return help();
	const controller = new AbortController();
	const interrupt = () => controller.abort();
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	const { signal } = controller;
	let unlock;
	let frontendUnlock;
	let sandbox;
	let created = false;
	let attached = false;
	try {
		if (options.action === "status") {
			sandbox = await Sandbox.open(ROOT, options.name);
			if (sandbox.state.phase === "ready") await sandbox.validateLive();
			return summary(sandbox.state);
		}
		if (options.action === "password") {
			unlock = await lock(ROOT, `password-${options.name}`);
			sandbox = await Sandbox.open(ROOT, options.name);
			await sandbox.validateLive();
			const password = await passwordInput(options, signal);
			await withAdmin(sandbox, signal, (api) =>
				setPassword(api, options.user, password),
			);
			console.info(
				`[sandbox] Password updated for ${options.user}. Sign in through the frontend.`,
			);
			return;
		}
		unlock = await lock(ROOT, `run-${options.name}`);
		sandbox = await Sandbox.open(ROOT, options.name, {
			create: options.action === "start",
		});
		if (options.action === "down") {
			await clean(sandbox);
			return;
		}
		if (!options["no-frontend"]) {
			frontendUnlock = await lock(ROOT, "frontend");
			await checkPort(options.server.port, options.server.listen);
			await checkDevelopmentProcess(ROOT);
		}
		let password;
		if (
			options.action === "start" &&
			(!options["no-frontend"] || options["password-stdin"])
		)
			password = await passwordInput(options, signal);
		if (options.action === "start") {
			await sandbox.allocate();
			created = true;
			await snapshotCompose(ROOT, join(sandbox.directory, "compose.yml"));
			const target = await obtainTarget(
				options,
				sandbox,
				join(ROOT, ".local/sandbox-cache"),
				signal,
			);
			Object.assign(sandbox.state, {
				image: target.image,
				revision: target.image.revision,
				selector: target.selector,
				pr: target.pr,
				prState: target.prState,
				headRepository: target.headRepository,
				corpus: target.corpus.manifest,
			});
			await sandbox.save();
			console.info(
				"[sandbox] Verifying the backup with the selected server image.",
			);
			await sandbox.offlineVerify(target.corpus, target.image, signal);
			console.info("[sandbox] Starting isolated PostgreSQL and Valkey.");
			await sandbox.compose(["up", "-d", "--no-deps", "postgres", "valkey"], {
				signal,
				timeout: 600_000,
			});
			await waitFor(
				"PostgreSQL",
				async () => {
					try {
						await sandbox.compose(
							[
								"exec",
								"-T",
								"postgres",
								"pg_isready",
								"-h",
								"127.0.0.1",
								"-U",
								"hubuum",
							],
							{ signal },
						);
						return true;
					} catch {
						return false;
					}
				},
				signal,
			);
			await waitFor(
				"Valkey",
				async () => {
					try {
						return (
							(
								await sandbox.compose(
									["exec", "-T", "valkey", "valkey-cli", "ping"],
									{ signal },
								)
							).trim() === "PONG"
						);
					} catch {
						return false;
					}
				},
				signal,
			);
			console.info(
				"[sandbox] Migrating and restoring the comprehensive corpus.",
			);
			await sandbox.admin(["--migrate"], { signal });
			await sandbox.admin(
				[
					"--restore",
					"/tmp/hubuum-sandbox-corpus.json",
					"--restore-confirmation",
					"REPLACE ALL HUBUUM DATA",
				],
				{ signal, corpus: target.corpus },
			);
			await sandbox.compose(
				["up", "-d", "--no-deps", "hubuum", "restore-executor"],
				{ signal },
			);
			await sandbox.recordServices();
			await sandbox.save();
			await waitFor(
				"Hubuum",
				async () => {
					try {
						await apiClient(
							`http://127.0.0.1:${sandbox.state.backendPort}`,
							undefined,
							signal,
						)("/readyz");
						return true;
					} catch {
						return false;
					}
				},
				signal,
			);
			console.info(
				"[sandbox] Checking restored counts, schema validation, and computed fields.",
			);
			await withAdmin(sandbox, signal, async (api) => {
				await verifyCorpus(api, target.corpus, signal);
				if (password) await setPassword(api, options.user, password);
			});
			sandbox.state.phase = "ready";
			await sandbox.save();
		} else {
			await sandbox.validateLive();
		}
		summary(sandbox.state);
		if (!options["no-frontend"]) {
			attached = true;
			await launchFrontend(sandbox.state, options, signal);
		}
	} finally {
		try {
			if ((created || attached) && !options.keep && !options["no-frontend"])
				await clean(sandbox);
			else if (created && sandbox.state.phase !== "ready" && !options.keep)
				await clean(sandbox);
			else if (created || attached)
				console.info(
					`[sandbox] Retained '${options.name}'. Use status, resume, password, or down.`,
				);
		} finally {
			await frontendUnlock?.();
			await unlock?.();
			process.removeListener("SIGINT", interrupt);
			process.removeListener("SIGTERM", interrupt);
		}
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((error) => {
		console.error(
			`[sandbox] ${error.name === "AbortError" ? "Interrupted." : error.message}`,
		);
		process.exitCode = 1;
	});
}
