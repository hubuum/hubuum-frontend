import { constants } from "node:fs";
import { access, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, isAbsolute, join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

import {
	atomicJson,
	command,
	DIGEST,
	hash,
	readJson,
	requireValue,
	SHA,
} from "./core.mjs";

const OWNER = "io.hubuum.sandbox.owner";
const RUN = "io.hubuum.sandbox.run";
const PROJECT = "io.hubuum.sandbox.project";

export async function findRuntime() {
	const requested = process.env.HUBUUM_CONTAINER_RUNTIME;
	for (const name of requested ? [requested] : ["docker", "podman"]) {
		for (const path of isAbsolute(name)
			? [name]
			: (process.env.PATH ?? "")
					.split(delimiter)
					.map((entry) => join(entry, name))) {
			try {
				await access(path, constants.X_OK);
				return path;
			} catch {
				/* Try the next executable. */
			}
		}
	}
	throw new Error(
		"Install Docker or Podman with a Compose provider, or set HUBUUM_CONTAINER_RUNTIME.",
	);
}

export function validateState(state, owner, name) {
	requireValue(
		state?.version === 1 && state.owner === owner && state.name === name,
		"Sandbox state belongs to another checkout or uses an unsupported version.",
	);
	requireValue(
		/^[a-f0-9-]{36}$/.test(state.run) &&
			state.project ===
				`hubuum-sandbox-${owner}-${name}-${state.run.slice(0, 8)}`,
		"Invalid sandbox ownership state.",
	);
	requireValue(isAbsolute(state.runtime), "Invalid recorded runtime.");
	if (state.phase === "ready") {
		requireValue(
			SHA.test(state.revision) &&
				DIGEST.test(state.image?.id) &&
				(state.image.ref === state.image.id ||
					/^ghcr\.io\/hubuum\/hubuum-server@sha256:[a-f0-9]{64}$/.test(
						state.image.ref,
					)),
			"Invalid recorded image identity.",
		);
		for (const port of [state.backendPort, state.valkeyPort])
			requireValue(
				Number.isInteger(port) && port > 0 && port < 65536,
				"Invalid recorded sandbox port.",
			);
		for (const service of ["postgres", "valkey", "hubuum", "restore-executor"])
			requireValue(
				/^[a-f0-9]{64}$/.test(state.containers?.[service]),
				"Invalid recorded container identity.",
			);
	}
	return state;
}

export class Sandbox {
	constructor(root, name, owner, directory, state) {
		Object.assign(this, { root, name, owner, directory, state });
		this.secrets = {};
	}

	static async open(root, name, { create = false } = {}) {
		root = await realpath(root);
		const owner = hash(root).slice(0, 12);
		const directory = join(root, ".local", "sandboxes", name);
		let state;
		try {
			state = validateState(
				await readJson(join(directory, "state.json")),
				owner,
				name,
			);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (create)
			requireValue(
				!state,
				`Sandbox '${name}' already exists. Use resume or down.`,
			);
		else requireValue(state, `Sandbox '${name}' does not exist.`);
		return new Sandbox(root, name, owner, directory, state);
	}

	async allocate() {
		const run = randomUUID();
		this.state = {
			version: 1,
			owner: this.owner,
			name: this.name,
			run,
			project: `hubuum-sandbox-${this.owner}-${this.name}-${run.slice(0, 8)}`,
			runtime: await findRuntime(),
			phase: "preparing",
			createdAt: new Date().toISOString(),
		};
		this.secrets = {
			SANDBOX_DB_PASSWORD: randomBytes(24).toString("hex"),
			SANDBOX_TOKEN_KEY: randomBytes(32).toString("hex"),
		};
		await this.save();
	}

	async save() {
		await atomicJson(join(this.directory, "state.json"), this.state);
	}
	run(args, options = {}) {
		return command(this.state.runtime, args, options);
	}
	async inspectImage(reference) {
		return JSON.parse(
			await this.run(["image", "inspect", reference], {
				label: "Image inspection",
				sensitive: true,
			}),
		)[0];
	}
	async inspectContainer(id) {
		return JSON.parse(
			await this.run(["container", "inspect", id], {
				label: "Container inspection",
				sensitive: true,
			}),
		)[0];
	}

	filters() {
		return [
			"--filter",
			`label=${OWNER}=${this.owner}`,
			"--filter",
			`label=${RUN}=${this.state.run}`,
		];
	}
	labels() {
		return [
			"--label",
			`${OWNER}=${this.owner}`,
			"--label",
			`${RUN}=${this.state.run}`,
			"--label",
			`${PROJECT}=${this.state.project}`,
		];
	}
	checkLabels(labels) {
		requireValue(
			labels?.[OWNER] === this.owner &&
				labels?.[RUN] === this.state.run &&
				labels?.[PROJECT] === this.state.project,
			"Container resource ownership mismatch; refusing to modify it.",
		);
	}

	compose(args, { signal, ...options } = {}) {
		return this.run(
			[
				"compose",
				"--env-file",
				"/dev/null",
				"-f",
				join(this.directory, "compose.yml"),
				"-p",
				this.state.project,
				...args,
			],
			{
				signal,
				sensitive: true,
				label: `Sandbox Compose ${args[0]}`,
				...options,
				env: {
					...process.env,
					...this.secrets,
					SANDBOX_OWNER: this.owner,
					SANDBOX_RUN: this.state.run,
					SANDBOX_PROJECT: this.state.project,
					SANDBOX_IMAGE: this.state.image.ref,
				},
			},
		);
	}

	async offlineVerify(corpus, image, signal) {
		const output = await this.run(
			[
				"run",
				"--rm",
				"--interactive",
				"--name",
				`${this.state.project}-verify`,
				...this.labels(),
				"--network",
				"none",
				"--entrypoint",
				"/bin/sh",
				image.ref,
				"-c",
				'cat > /tmp/hubuum-sandbox-corpus.json && exec /usr/local/bin/hubuum-admin "$@"',
				"sandbox-admin",
				"--verify-backup",
				"/tmp/hubuum-sandbox-corpus.json",
				"--json",
			],
			{
				signal,
				label: "Offline corpus verification",
				input: await readFile(join(corpus.directory, "comprehensive.json")),
			},
		);
		requireValue(
			JSON.parse(output).result === "passed",
			"The selected server rejected this corpus.",
		);
	}

	async admin(args, { signal, corpus } = {}) {
		return this.compose(
			[
				"run",
				"--rm",
				"-T",
				"--no-deps",
				"--entrypoint",
				corpus ? "/bin/sh" : "/usr/local/bin/hubuum-admin",
				"hubuum",
				...(corpus
					? [
							"-c",
							'cat > /tmp/hubuum-sandbox-corpus.json && exec /usr/local/bin/hubuum-admin "$@"',
							"sandbox-admin",
						]
					: []),
				...args,
			],
			{
				signal,
				timeout: 300_000,
				input: corpus
					? await readFile(join(corpus.directory, "comprehensive.json"))
					: undefined,
			},
		);
	}

	async containers() {
		const ids = (
			await this.run(["ps", "--all", "--quiet", ...this.filters()], {
				sensitive: true,
				label: "Sandbox discovery",
			})
		)
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		const result = [];
		for (const id of ids) {
			const info = await this.inspectContainer(id);
			this.checkLabels(info.Config?.Labels);
			result.push(info);
		}
		return result;
	}

	async recordServices() {
		const containers = {};
		for (const info of await this.containers()) {
			const service = info.Config.Labels["com.docker.compose.service"];
			if (
				["postgres", "valkey", "hubuum", "restore-executor"].includes(service)
			) {
				requireValue(
					!containers[service] && info.State.Running,
					`Expected one running ${service} container.`,
				);
				containers[service] = info.Id;
			}
		}
		requireValue(
			Object.keys(containers).length === 4,
			"Sandbox services are incomplete.",
		);
		this.state.containers = containers;
		this.state.backendPort = await this.port(containers.hubuum, 8080);
		this.state.valkeyPort = await this.port(containers.valkey, 6379);
	}

	async port(id, port) {
		const address = (
			await this.run(["port", id, `${port}/tcp`], {
				label: "Sandbox port discovery",
				sensitive: true,
			})
		).trim();
		const match = /^127\.0\.0\.1:(\d+)$/.exec(address);
		requireValue(
			match && Number(match[1]) > 0 && Number(match[1]) < 65536,
			"Expected one loopback-only published port.",
		);
		return Number(match[1]);
	}

	async validateLive() {
		requireValue(
			this.state.phase === "ready",
			"Sandbox setup is incomplete. Use down and start a fresh sandbox.",
		);
		const image = await this.inspectImage(this.state.image.id);
		requireValue(
			(image.Id.startsWith("sha256:") ? image.Id : `sha256:${image.Id}`) ===
				this.state.image.id,
			"Recorded image is no longer available.",
		);
		for (const [service, id] of Object.entries(this.state.containers)) {
			const info = await this.inspectContainer(id);
			this.checkLabels(info.Config?.Labels);
			requireValue(
				info.State.Running &&
					info.Config.Labels["com.docker.compose.service"] === service,
				`${service} is no longer running; use down and start again.`,
			);
			if (service === "hubuum" || service === "restore-executor")
				requireValue(
					(info.Image.startsWith("sha256:")
						? info.Image
						: `sha256:${info.Image}`) === this.state.image.id,
					"Running server image differs from recorded state.",
				);
			if (service === "postgres")
				this.secrets.SANDBOX_DB_PASSWORD = envValue(info, "POSTGRES_PASSWORD");
			if (service === "hubuum")
				this.secrets.SANDBOX_TOKEN_KEY = envValue(
					info,
					"HUBUUM_TOKEN_HASH_KEY",
				);
		}
		requireValue(
			(await this.port(this.state.containers.hubuum, 8080)) ===
				this.state.backendPort &&
				(await this.port(this.state.containers.valkey, 6379)) ===
					this.state.valkeyPort,
			"Recorded sandbox ports have changed.",
		);
	}

	async cleanup() {
		for (const info of await this.containers())
			await this.run(["rm", "--force", "--volumes", info.Id], {
				sensitive: true,
				label: "Sandbox container cleanup",
			});
		for (const [kind, format] of [
			["network", "{{.ID}}"],
			["volume", "{{.Name}}"],
		]) {
			const ids = (
				await this.run([kind, "ls", ...this.filters(), "--format", format], {
					sensitive: true,
					label: "Sandbox resource discovery",
				})
			)
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			for (const id of ids) {
				const info = JSON.parse(
					await this.run([kind, "inspect", id], { sensitive: true }),
				)[0];
				this.checkLabels(info.Labels ?? info.labels);
				await this.run([kind, "rm", id], {
					sensitive: true,
					label: "Sandbox resource cleanup",
				});
			}
		}
		await rm(this.directory, { recursive: true, force: true });
	}
}

function envValue(info, key) {
	const value = info.Config.Env.find((entry) =>
		entry.startsWith(`${key}=`),
	)?.slice(key.length + 1);
	requireValue(value, "Sandbox container configuration is incomplete.");
	return value;
}

export async function lock(root, name) {
	const directory = join(root, ".local", "sandbox-locks");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${name}.lock`);
	let handle;
	try {
		handle = await open(path, "wx", 0o600);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		const pid = Number(await readFile(path, "utf8"));
		requireValue(
			Number.isSafeInteger(pid) && pid > 0,
			"Invalid sandbox lock; inspect it before removing it.",
		);
		let active = true;
		try {
			process.kill(pid, 0);
		} catch (probe) {
			if (probe.code === "ESRCH") active = false;
		}
		requireValue(
			!active,
			"Sandbox is busy. Stop its frontend with Ctrl-C before resume or down.",
		);
		await rm(path);
		handle = await open(path, "wx", 0o600);
	}
	await handle.writeFile(String(process.pid));
	await handle.close();
	return () => rm(path, { force: true });
}

export async function checkPort(port, host) {
	await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", () =>
			reject(
				new Error(
					`Frontend port ${port} is unavailable on ${host}. Choose --port.`,
				),
			),
		);
		server.listen(Number(port), host, () => server.close(resolve));
	});
}

export async function checkDevelopmentProcess(root, probe = process.kill) {
	let info;
	try {
		info = await readJson(join(root, ".next/dev/lock"));
	} catch {
		// Next.js remains responsible for its native advisory lock, including
		// older/unrecognised lockfile formats. Never delete its lockfile here.
		return;
	}
	if (!Number.isSafeInteger(info?.pid) || info.pid <= 0) return;
	try {
		probe(info.pid, 0);
	} catch (error) {
		if (error.code === "ESRCH") return;
	}
	throw new Error(
		"This checkout already has a Next.js development process. Stop that frontend before starting another.",
	);
}

export function frontendEnvironment(state, inherited = process.env) {
	return {
		...inherited,
		BACKEND_BASE_URL: `http://127.0.0.1:${state.backendPort}`,
		VALKEY_URL: `redis://127.0.0.1:${state.valkeyPort}/0`,
		SESSION_PREFIX: `sandbox:${state.run}:session:`,
		SETTINGS_PREFIX: `sandbox:${state.run}:settings:`,
	};
}
