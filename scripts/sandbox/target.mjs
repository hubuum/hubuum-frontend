import {
	access,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";

import {
	atomicJson,
	boundedFetch,
	command,
	DIGEST,
	hash,
	IMAGE,
	MAX_BACKUP,
	readJson,
	REPOSITORY,
	requireValue,
	resolveSource,
	SHA,
	validateCorpus,
} from "./core.mjs";

const BUILD_FLAGS = "-F tls-rustls -F tls-openssl --locked --release";

export async function corpusFiles(revision, cache, signal, source) {
	requireValue(SHA.test(revision), "Invalid corpus source revision.");
	const directory = join(cache, "corpora", revision);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	for (const [name, limit] of [
		["comprehensive.manifest.json", 1024 * 1024],
		["recipe.json", 1024 * 1024],
		["comprehensive.json", MAX_BACKUP],
	]) {
		const path = join(directory, name);
		try {
			await access(path);
		} catch {
			let bytes;
			if (source) {
				const original = join(source, "test-corpora", name);
				requireValue(
					(await lstat(original)).isFile() &&
						(await realpath(original)).startsWith(
							`${await realpath(source)}${sep}`,
						),
					"Corpus artifacts must be regular files.",
				);
				requireValue(
					(await stat(original)).size <= limit,
					"Source corpus exceeds its size limit.",
				);
				bytes = await readFile(original);
			} else {
				bytes = await boundedFetch(
					`https://raw.githubusercontent.com/${REPOSITORY}/${revision}/test-corpora/${name}`,
					{ limit, signal },
				);
			}
			const temporary = `${path}.${process.pid}.tmp`;
			await writeFile(temporary, bytes, { mode: 0o600 });
			try {
				// Each source revision is immutable; concurrent writers have identical inputs.
				await rename(temporary, path);
			} finally {
				await rm(temporary, { force: true });
			}
		}
		requireValue(
			(await lstat(path)).isFile() && (await stat(path)).size <= limit,
			"Cached corpus exceeds its size limit.",
		);
	}
	const manifest = await readJson(
		join(directory, "comprehensive.manifest.json"),
	);
	const recipe = validateCorpus(
		manifest,
		await readFile(join(directory, "recipe.json")),
		await readFile(join(directory, "comprehensive.json")),
	);
	return { directory, manifest, recipe };
}

export function imageIdentity(info, revision, local = false) {
	const labels = info?.Config?.Labels;
	requireValue(
		SHA.test(labels?.["org.opencontainers.image.revision"]),
		"Image has no valid source revision label.",
	);
	requireValue(
		labels["org.opencontainers.image.source"] ===
			`https://github.com/${REPOSITORY}`,
		"Image source is not the Hubuum repository.",
	);
	const actual = labels["org.opencontainers.image.revision"];
	requireValue(
		!revision || actual === revision,
		"Image source revision does not match the selected commit.",
	);
	const id = info.Id?.startsWith("sha256:") ? info.Id : `sha256:${info.Id}`;
	requireValue(
		DIGEST.test(id),
		"Container runtime returned an invalid image ID.",
	);
	const ref = local
		? id
		: info.RepoDigests?.find(
				(item) =>
					item.startsWith(`${IMAGE}@`) &&
					DIGEST.test(item.slice(IMAGE.length + 1)),
			);
	requireValue(ref, "Published image has no registry digest.");
	return {
		ref,
		id,
		revision: actual,
		local,
		platform: `${info.Os ?? info.OS ?? "linux"}/${info.Architecture}`,
	};
}

async function sourceSnapshot(source, cache, signal) {
	await mkdir(join(cache, "sources"), { recursive: true, mode: 0o700 });
	const directory = await mkdtemp(
		join(cache, "sources", `${source.revision}-`),
	);
	const env = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_COUNT: "0",
		GIT_TERMINAL_PROMPT: "0",
	};
	delete env.GH_TOKEN;
	delete env.GITHUB_TOKEN;
	const git = (args) =>
		command(
			"git",
			["-c", "core.hooksPath=/dev/null", "-c", "init.templateDir=", ...args],
			{ cwd: directory, env, signal, label: "Server source fetch" },
		);
	try {
		await git(["init", "--quiet"]);
		try {
			await git([
				"fetch",
				"--quiet",
				"--depth=1",
				`https://github.com/${REPOSITORY}.git`,
				source.revision,
			]);
		} catch (error) {
			if (!source.pr || signal?.aborted) throw error;
			await git([
				"fetch",
				"--quiet",
				"--depth=1",
				`https://github.com/${REPOSITORY}.git`,
				`refs/pull/${source.pr}/head`,
			]);
		}
		requireValue(
			(await git(["rev-parse", "FETCH_HEAD"])).trim() === source.revision,
			"PR source moved during resolution; the pinned commit could not be fetched.",
		);
		await git(["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
		// The build receives source files only, without resolver credentials or Git hooks.
		await rm(join(directory, ".git"), { recursive: true, force: true });
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

export async function obtainTarget(options, runtime, cache, signal) {
	const source = await resolveSource(options, undefined, signal);
	const reference =
		options.image || `${IMAGE}:${options.tag || `sha-${source.revision}`}`;
	console.info(
		`[sandbox] Resolving ${options.pr ? `PR #${options.pr} (${source.prState}), ${source.revision}` : reference}`,
	);
	let image;
	let corpus;
	try {
		await runtime.run(["pull", "--quiet", reference], {
			signal,
			timeout: 600_000,
			label: "Server image pull",
		});
		image = imageIdentity(
			await runtime.inspectImage(reference),
			source.revision,
		);
	} catch (error) {
		if (!error.missingManifest || !source.revision || options["no-build"])
			throw error;
		console.info(
			`[sandbox] No published image for ${source.revision}; building the selected source.`,
		);
		const directory = await sourceSnapshot(source, cache, signal);
		try {
			corpus = await corpusFiles(source.revision, cache, signal, directory);
			requireValue(
				(await lstat(join(directory, "Dockerfile"))).isFile(),
				"The server Dockerfile must be a regular file.",
			);
			const platform = process.arch === "arm64" ? "linux/arm64" : "linux/amd64";
			const key = hash(
				`${source.revision}\n${platform}\n${BUILD_FLAGS}\n${await readFile(join(directory, "Dockerfile"), "utf8")}`,
			);
			const cacheFile = join(cache, "builds", `${key}.json`);
			try {
				const cached = await readJson(cacheFile);
				requireValue(
					cached.key === key && DIGEST.test(cached.id),
					"Invalid local build cache.",
				);
				const candidate = imageIdentity(
					await runtime.inspectImage(cached.id),
					source.revision,
					true,
				);
				requireValue(
					candidate.platform === platform,
					"Cached image platform mismatch.",
				);
				image = candidate;
			} catch {
				/* A missing local image is rebuilt for a fresh run. */
			}
			if (!image) {
				const tag = `localhost/hubuum-sandbox:${key}`;
				await runtime.run(
					[
						"build",
						"--platform",
						platform,
						"--build-arg",
						`CARGO_BUILD_FLAGS=${BUILD_FLAGS}`,
						"--build-arg",
						`HUBUUM_BUILD_GIT_SHA=${source.revision}`,
						"--label",
						`org.opencontainers.image.source=https://github.com/${REPOSITORY}`,
						"--label",
						`org.opencontainers.image.revision=${source.revision}`,
						"--tag",
						tag,
						directory,
					],
					{
						signal,
						timeout: 3_600_000,
						progress: true,
						label: "Server image build",
					},
				);
				image = imageIdentity(
					await runtime.inspectImage(tag),
					source.revision,
					true,
				);
				await atomicJson(cacheFile, { key, id: image.id });
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
	corpus ??= await corpusFiles(image.revision, cache, signal);
	return {
		...source,
		image,
		corpus,
		selector: { kind: options.selector, value: options[options.selector] },
	};
}

export async function snapshotCompose(root, destination) {
	await copyFile(join(root, "compose.sandbox.yml"), destination);
}
