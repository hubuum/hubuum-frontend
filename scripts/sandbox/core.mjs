import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";

import { parseServerOptions } from "../server-options.mjs";

export const REPOSITORY = "hubuum/hubuum";
export const IMAGE = "ghcr.io/hubuum/hubuum-server";
export const SHA = /^[a-f0-9]{40}$/;
export const DIGEST = /^sha256:[a-f0-9]{64}$/;
export const MAX_BACKUP = 25 * 1024 * 1024;
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function requireValue(condition, message) {
	if (!condition) throw new Error(message);
}

export function parseOptions(args, env = process.env) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			tag: { type: "string" },
			sha: { type: "string" },
			pr: { type: "string" },
			image: { type: "string" },
			name: { type: "string", default: "default" },
			corpus: { type: "string", default: "comprehensive" },
			user: { type: "string", default: "corpus-admin" },
			port: { type: "string", short: "p" },
			listen: { type: "string" },
			keep: { type: "boolean", default: false },
			"no-build": { type: "boolean", default: false },
			"no-frontend": { type: "boolean", default: false },
			"password-stdin": { type: "boolean", default: false },
			help: { type: "boolean", short: "h" },
		},
	});
	if (values.help) return { help: true };
	const action = positionals[0] ?? "start";
	requireValue(
		positionals.length <= 1 &&
			["start", "resume", "status", "down", "password"].includes(action),
		"Expected start, resume, status, down, or password.",
	);
	requireValue(
		/^[a-z][a-z0-9-]{0,31}$/.test(values.name),
		"Name must start with a lowercase letter and contain at most 32 letters, digits, or hyphens.",
	);
	requireValue(
		values.corpus === "comprehensive",
		"Supported corpus: comprehensive.",
	);
	requireValue(
		/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(values.user),
		"Invalid local username.",
	);
	const selectors = ["tag", "sha", "pr", "image"].filter(
		(key) => values[key] !== undefined,
	);
	requireValue(
		selectors.length === (action === "start" ? 1 : 0),
		"Start requires exactly one of --tag, --sha, --pr, or --image; other commands use recorded state.",
	);
	for (const selector of selectors)
		requireValue(
			values[selector].length > 0,
			`--${selector} requires a value.`,
		);
	if (values.tag)
		requireValue(/^[\w][\w.-]{0,127}$/.test(values.tag), "Invalid image tag.");
	if (values.sha) {
		values.sha = values.sha.toLowerCase();
		requireValue(
			/^[a-f0-9]{7,40}$/.test(values.sha),
			"--sha requires 7–40 hexadecimal Git commit characters.",
		);
	}
	if (values.image)
		requireValue(
			new RegExp(`^${IMAGE.replaceAll(".", "\\.")}@sha256:[a-f0-9]{64}$`).test(
				values.image,
			),
			"--image requires ghcr.io/hubuum/hubuum-server@sha256:<digest>.",
		);
	if (values.pr) values.pr = parsePr(values.pr);
	const serverArgs = [
		...(values.port ? ["--port", values.port] : []),
		...(values.listen ? ["--listen", values.listen] : []),
	];
	const server = parseServerOptions(serverArgs, env);
	requireValue(
		!values["no-frontend"] || values.keep || action === "resume",
		"--no-frontend requires --keep for a fresh sandbox.",
	);
	return { ...values, action, server, selector: selectors[0] };
}

export function parsePr(value) {
	const match =
		/^(?:https:\/\/github\.com\/hubuum\/hubuum\/pull\/)?([1-9]\d*)\/?$/.exec(
			value,
		);
	requireValue(
		match && Number.isSafeInteger(Number(match[1])),
		"--pr requires a PR number or https://github.com/hubuum/hubuum/pull/<number>.",
	);
	return Number(match[1]);
}

export function selectPr(data, number) {
	requireValue(
		data?.number === number && data?.base?.repo?.full_name === REPOSITORY,
		"PR metadata does not match the selected repository.",
	);
	const revision = data.merged ? data.merge_commit_sha : data.head?.sha;
	requireValue(SHA.test(revision), "The selected PR commit is unavailable.");
	return {
		revision,
		pr: number,
		prState: data.merged ? "merged" : data.state,
		headRepository: data.head?.repo?.full_name ?? null,
	};
}

// Never attach raw spawn errors or command arguments: those can contain secrets.
export function command(
	program,
	args,
	{
		env = process.env,
		cwd,
		signal,
		input,
		timeout = 180_000,
		label = "Command",
		sensitive = false,
		progress = false,
		maxBytes = 4 * 1024 * 1024,
	} = {},
) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("Operation interrupted."));
		const child = spawn(program, args, {
			cwd,
			env,
			stdio: ["pipe", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		let stdout = "";
		let stderr = "";
		let reason;
		let forceTimer;
		const kill = (kind) => {
			try {
				if (process.platform === "win32") child.kill(kind);
				else if (child.pid) process.kill(-child.pid, kind);
			} catch {
				/* The process may already have exited. */
			}
		};
		const stop = (message) => {
			if (reason) return;
			reason = message;
			kill("SIGTERM");
			forceTimer = setTimeout(() => kill("SIGKILL"), 2000);
		};
		const abort = () => stop("Operation interrupted.");
		const timer = setTimeout(() => stop(`${label} timed out.`), timeout);
		signal?.addEventListener("abort", abort, { once: true });
		const finish = () => {
			clearTimeout(timer);
			clearTimeout(forceTimer);
			signal?.removeEventListener("abort", abort);
		};
		child.on("error", () => {
			finish();
			reject(
				new Error(
					`${label} could not start. Check that ${program.split(/[\\/]/).at(-1)} is installed.`,
				),
			);
		});
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
			if (progress && !sensitive) process.stderr.write(chunk);
			if (stdout.length > maxBytes) {
				if (progress) stdout = stdout.slice(-maxBytes);
				else stop(`${label} exceeded its output limit.`);
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr = (stderr + chunk.toString()).slice(-maxBytes);
			if (progress && !sensitive) process.stderr.write(chunk);
		});
		child.stdin.on("error", () => {});
		child.stdin.end(input);
		child.on("close", (code) => {
			finish();
			if (reason) return reject(new Error(reason));
			if (code !== 0) {
				const error = new Error(
					`${label} failed (exit ${code}).${sensitive ? "" : ` ${stderr.trim().slice(-1200)}`}`,
				);
				error.missingManifest =
					!sensitive &&
					/manifest unknown|manifest[^\n]*not found|name unknown/i.test(stderr);
				return reject(error);
			}
			resolve(stdout);
		});
	});
}

export async function atomicJson(path, data) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

export async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function boundedFetch(
	url,
	{ limit = 1024 * 1024, signal, headers = {}, fetcher = fetch } = {},
) {
	const response = await fetcher(url, {
		headers,
		redirect: "error",
		signal: signal
			? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
			: AbortSignal.timeout(60_000),
	});
	requireValue(
		response.ok,
		`Download failed (HTTP ${response.status}). Check target availability and GitHub rate limits.`,
	);
	requireValue(
		Number(response.headers.get("content-length") || 0) <= limit,
		"Download exceeds its size limit.",
	);
	let length = 0;
	const chunks = [];
	for await (const chunk of response.body) {
		length += chunk.length;
		requireValue(length <= limit, "Download exceeds its size limit.");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

export async function github(path, signal) {
	const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	const headers = {
		Accept: "application/vnd.github+json",
		...(token ? { Authorization: `Bearer ${token}` } : {}),
	};
	return JSON.parse(
		await boundedFetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
			signal,
			headers,
		}),
	);
}

export async function resolveSource(options, api = github, signal) {
	if (options.pr)
		return selectPr(await api(`pulls/${options.pr}`, signal), options.pr);
	if (options.sha) {
		const data = await api(`commits/${options.sha}`, signal);
		requireValue(
			SHA.test(data?.sha) && data.sha.startsWith(options.sha),
			"Unknown or ambiguous Git commit prefix.",
		);
		return { revision: data.sha };
	}
	return {};
}

export function validateCorpus(manifest, recipeBytes, backupBytes) {
	requireValue(
		manifest?.name === "comprehensive" &&
			Number.isSafeInteger(manifest.recipe_revision) &&
			manifest.recipe_revision > 0,
		"Unsupported corpus manifest.",
	);
	const recipe = JSON.parse(recipeBytes);
	requireValue(
		recipe.name === manifest.name &&
			recipe.revision === manifest.recipe_revision,
		"Corpus recipe revision mismatch.",
	);
	requireValue(
		/^[a-f0-9]{64}$/.test(manifest.recipe_sha256) &&
			hash(recipeBytes) === manifest.recipe_sha256,
		"Corpus recipe checksum mismatch.",
	);
	requireValue(
		/^[a-f0-9]{64}$/.test(manifest.sha256) &&
			hash(backupBytes) === manifest.sha256,
		"Corpus backup checksum mismatch.",
	);
	requireValue(
		Number.isSafeInteger(manifest.byte_size) &&
			manifest.byte_size === backupBytes.length &&
			backupBytes.length <= MAX_BACKUP,
		"Corpus backup size mismatch.",
	);
	requireValue(
		Number.isSafeInteger(manifest.backup_version),
		"Invalid corpus backup version.",
	);
	requireValue(
		Array.isArray(recipe.classes) &&
			recipe.classes.length > 0 &&
			manifest.anchors?.classes &&
			manifest.state_counts,
		"Corpus scenario metadata is missing.",
	);
	for (const item of recipe.classes)
		requireValue(
			typeof item.name === "string" &&
				Number.isSafeInteger(item.objects) &&
				item.objects >= 0 &&
				Number.isSafeInteger(manifest.anchors.classes[item.name]) &&
				manifest.anchors.classes[item.name] > 0,
			"Invalid class scenario metadata.",
		);
	requireValue(
		manifest.state_counts.classes === recipe.classes.length &&
			manifest.state_counts.objects ===
				recipe.classes.reduce((total, item) => total + item.objects, 0) &&
			new Set(recipe.classes.map((item) => item.name)).size ===
				recipe.classes.length,
		"Corpus recipe and manifest counts differ.",
	);
	return recipe;
}
