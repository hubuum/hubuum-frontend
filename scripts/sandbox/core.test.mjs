import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import {
	command,
	hash,
	boundedFetch,
	parseOptions,
	resolveSource,
	selectPr,
	validateCorpus,
} from "./core.mjs";
import {
	checkDevelopmentProcess,
	frontendEnvironment,
	Sandbox,
	validateState,
} from "./runtime.mjs";
import { imageIdentity } from "./target.mjs";
import {
	hiddenPrompt,
	pages,
	readPassword,
	setPassword,
	validatePassword,
} from "./auth.mjs";

const revision = "5baa9008cce9929b123624067266d3fe221eeb69";
const head = "898c757cd44262506bc0943ec69b1f94e73e96e5";
const digest = `sha256:${"a".repeat(64)}`;

test("selectors are explicit and preserve sandbox/server options", () => {
	const options = parseOptions(
		[
			"--pr",
			"https://github.com/hubuum/hubuum/pull/411",
			"--keep",
			"--name",
			"review",
			"--port",
			"4000",
		],
		{},
	);
	assert.equal(options.pr, 411);
	assert.equal(options.selector, "pr");
	assert.equal(options.server.port, "4000");
	assert.equal(options.server.listen, "127.0.0.1");
	assert.equal(options.keep, true);
	assert.equal(
		parseOptions(["password", "--user", "corpus-reader"]).user,
		"corpus-reader",
	);
});

test("invalid or conflicting targets fail before doing work", () => {
	for (const args of [
		[],
		["--sha", "abc"],
		["--sha", "5baa9008", "--tag", "main"],
		["--pr", "https://github.com/another/repo/pull/411"],
		["--tag", "main;echo"],
		["--image", "sha256:bad"],
		["--tag", "main", "--name", "../victim"],
		["--tag", "main", "--corpus", "unknown"],
		["resume", "--sha", revision],
		["--tag", "main", "--no-frontend"],
		["--tag", ""],
		["--sha", ""],
	])
		assert.throws(() => parseOptions(args));
});

test("PR states select head or actual merge, including deleted forks", () => {
	const metadata = {
		number: 411,
		base: { repo: { full_name: "hubuum/hubuum" } },
		head: { sha: head, repo: null },
		merge_commit_sha: revision,
	};
	assert.equal(
		selectPr({ ...metadata, state: "open", merged: false }, 411).revision,
		head,
	);
	assert.equal(
		selectPr({ ...metadata, state: "closed", merged: false }, 411).revision,
		head,
	);
	assert.equal(
		selectPr({ ...metadata, state: "closed", merged: true }, 411).revision,
		revision,
	);
	assert.throws(() =>
		selectPr({ ...metadata, merged: true, merge_commit_sha: null }, 411),
	);
});

test("SHA resolution verifies the requested prefix rather than accepting a ref alias", async () => {
	assert.deepEqual(
		await resolveSource({ sha: "5baa9008" }, async () => ({ sha: revision })),
		{ revision },
	);
	await assert.rejects(
		resolveSource({ sha: "5baa9008" }, async () => ({ sha: head })),
		/ambiguous/,
	);
});

test("image labels must match repository and selected commit; local IDs need no RepoDigest", () => {
	const info = {
		Id: digest,
		Architecture: "amd64",
		Os: "linux",
		Config: {
			Labels: {
				"org.opencontainers.image.source": "https://github.com/hubuum/hubuum",
				"org.opencontainers.image.revision": revision,
			},
		},
		RepoDigests: [`ghcr.io/hubuum/hubuum-server@${digest}`],
	};
	assert.equal(imageIdentity(info, revision).ref, info.RepoDigests[0]);
	assert.equal(
		imageIdentity({ ...info, RepoDigests: [] }, revision, true).ref,
		digest,
	);
	assert.throws(() => imageIdentity(info, head), /does not match/);
	assert.throws(
		() => imageIdentity({ ...info, Config: { Labels: {} } }),
		/revision/,
	);
	assert.throws(
		() => imageIdentity({ ...info, RepoDigests: [] }, revision),
		/registry digest/,
	);
});

function corpus() {
	const recipe = Buffer.from(
		JSON.stringify({
			name: "comprehensive",
			revision: 2,
			classes: [{ name: "example", objects: 1 }],
		}),
	);
	const backup = Buffer.from("{}");
	return {
		recipe,
		backup,
		manifest: {
			name: "comprehensive",
			recipe_revision: 2,
			recipe_sha256: hash(recipe),
			sha256: hash(backup),
			byte_size: backup.length,
			backup_version: 6,
			state_counts: { classes: 1, objects: 1 },
			anchors: { classes: { example: 1 } },
		},
	};
}

test("corpus validation rejects changed bytes, wrong recipes, and unsafe anchors", () => {
	const { manifest, recipe, backup } = corpus();
	assert.equal(validateCorpus(manifest, recipe, backup).revision, 2);
	assert.throws(
		() => validateCorpus(manifest, recipe, Buffer.from("{ }")),
		/checksum/,
	);
	assert.throws(
		() => validateCorpus({ ...manifest, recipe_revision: 3 }, recipe, backup),
		/revision/,
	);
	assert.throws(
		() => validateCorpus({ ...manifest, byte_size: 99 }, recipe, backup),
		/size/,
	);
	assert.throws(
		() =>
			validateCorpus(
				{ ...manifest, anchors: { classes: { example: -1 } } },
				recipe,
				backup,
			),
		/scenario/,
	);
});

test("stdin passwords support UTF-8 boundaries, bounded input, and interruption", async () => {
	const stream = new PassThrough();
	const password = "chosen-é-password";
	const bytes = Buffer.from(`${password}\n`);
	const result = readPassword(stream);
	for (const byte of bytes) stream.write(Buffer.from([byte]));
	stream.end();
	assert.equal(await result, password);
	const large = new PassThrough();
	const rejected = assert.rejects(readPassword(large), /too long/);
	large.write("x".repeat(1027));
	await rejected;
	const controller = new AbortController();
	const waiting = new PassThrough();
	const cancelled = assert.rejects(
		readPassword(waiting, controller.signal),
		/interrupted/,
	);
	controller.abort();
	await cancelled;
	assert.equal(waiting.listenerCount("data"), 0);
});

test("Next.js preflight distinguishes an active process from an unlocked stale file", async () => {
	const root = await mkdtemp(join(tmpdir(), "sandbox-next-lock-"));
	const path = join(root, ".next/dev/lock");
	try {
		await mkdir(join(root, ".next/dev"), { recursive: true });
		const contents = JSON.stringify({ pid: 12345 });
		await writeFile(path, contents);
		await assert.rejects(
			checkDevelopmentProcess(root, () => {}),
			/development process/,
		);
		await checkDevelopmentProcess(root, () => {
			throw Object.assign(new Error("gone"), { code: "ESRCH" });
		});
		assert.equal(await readFile(path, "utf8"), contents);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("interactive passwords disable echo and install listeners before showing the prompt", async () => {
	const input = new PassThrough();
	input.isTTY = true;
	input.isRaw = false;
	input.setRawMode = (value) => {
		input.isRaw = value;
	};
	const output = {
		write(label) {
			if (label !== "Password: ") return;
			assert.equal(input.isRaw, true);
			assert.ok(input.listenerCount("keypress") > 0);
			input.emit("keypress", "immediate-paste");
			input.emit("keypress", "\r", { name: "return" });
		},
	};
	assert.equal(
		await hiddenPrompt("Password: ", undefined, { input, output }),
		"immediate-paste",
	);
	assert.equal(input.isRaw, false);
	assert.equal(input.listenerCount("keypress"), 0);
	assert.equal(input.isPaused(), true);
});

test("corpus staging uses stdin in disposable containers without host mounts", async () => {
	const directory = await mkdtemp(join(tmpdir(), "sandbox-staging-"));
	try {
		await writeFile(join(directory, "comprehensive.json"), "synthetic-fixture");
		const sandbox = new Sandbox("/tmp", "test", "owner", directory, {
			run: "run",
			project: "project",
		});
		const calls = [];
		sandbox.run = async (args, options) => {
			calls.push({ args, options });
			return JSON.stringify({ result: "passed" });
		};
		await sandbox.offlineVerify({ directory }, { ref: digest });
		sandbox.compose = sandbox.run;
		await sandbox.admin(["--restore", "/tmp/hubuum-sandbox-corpus.json"], {
			corpus: { directory },
		});
		for (const { args, options } of calls) {
			assert.ok(args.includes("--rm"));
			assert.ok(args.includes("/bin/sh"));
			assert.equal(args.includes("--mount"), false);
			assert.equal(options.input.toString(), "synthetic-fixture");
		}
		assert.ok(calls[0].args.includes("none"));
		assert.equal(
			await readFile(join(directory, "comprehensive.json"), "utf8"),
			"synthetic-fixture",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("downloads enforce declared and streamed sizes, and reject unavailable artifacts", async () => {
	await assert.rejects(
		boundedFetch("https://example.invalid", {
			limit: 2,
			fetcher: async () =>
				new Response("123", { headers: { "Content-Length": "3" } }),
		}),
		/size limit/,
	);
	await assert.rejects(
		boundedFetch("https://example.invalid", {
			limit: 2,
			fetcher: async () => new Response("123"),
		}),
		/size limit/,
	);
	await assert.rejects(
		boundedFetch("https://example.invalid", {
			fetcher: async () => new Response("", { status: 404 }),
		}),
		/HTTP 404/,
	);
});

test("timeouts and sensitive failures do not expose arguments, env, or stderr", async () => {
	const secret = "test-only-secret-marker";
	for (const [source, timeout] of [
		["setInterval(() => {}, 1000)", 40],
		["console.error(process.argv[1]); process.exit(1)", 1000],
	]) {
		await assert.rejects(
			command(process.execPath, ["-e", source, secret], {
				timeout,
				sensitive: true,
				label: "Credential operation",
			}),
			(error) => {
				assert.equal(String(error).includes(secret), false);
				assert.equal(String(error).includes(source), false);
				return true;
			},
		);
	}
});

test("only missing manifests trigger source-build eligibility", async () => {
	for (const [diagnostic, missing] of [
		["manifest unknown", true],
		["unauthorized: authentication required", false],
		["connection timed out", false],
	]) {
		await assert.rejects(
			command(process.execPath, [
				"-e",
				"console.error(process.argv[1]);process.exit(1)",
				diagnostic,
			]),
			(error) => {
				assert.equal(error.missingManifest, missing);
				return true;
			},
		);
	}
});

test("frontend connection settings override inherited targets without changing the source environment", () => {
	const inherited = {
		BACKEND_BASE_URL: "https://external.invalid",
		VALKEY_URL: "redis://external.invalid",
		SETTINGS_PREFIX: "shared",
		OTHER: "retained",
	};
	const actual = frontendEnvironment(
		{ run: "test", backendPort: 9999, valkeyPort: 16379 },
		inherited,
	);
	assert.equal(actual.BACKEND_BASE_URL, "http://127.0.0.1:9999");
	assert.equal(actual.VALKEY_URL, "redis://127.0.0.1:16379/0");
	assert.equal(actual.SETTINGS_PREFIX, "sandbox:test:settings:");
	assert.equal(inherited.BACKEND_BASE_URL, "https://external.invalid");
	assert.equal(actual.OTHER, "retained");
});

test("state ownership prevents adopting another checkout or arbitrary project", () => {
	const state = {
		version: 1,
		name: "review",
		owner: "owner",
		run: "c10b8b51-52a8-4783-b533-c0f3646c5c30",
		project: "hubuum-sandbox-owner-review-c10b8b51",
		runtime: "/usr/bin/docker",
		phase: "preparing",
	};
	assert.equal(validateState(state, "owner", "review"), state);
	assert.throws(
		() => validateState(state, "different", "review"),
		/another checkout/,
	);
	assert.throws(
		() =>
			validateState(
				{ ...state, project: "developer-project" },
				"owner",
				"review",
			),
		/ownership/,
	);
});

test("cleanup refuses containers with conflicting labels before issuing deletion", async () => {
	const sandbox = new Sandbox("/tmp", "test", "owner", "/tmp/unused", {
		run: "run",
		project: "project",
	});
	const calls = [];
	sandbox.run = async (args) => {
		calls.push(args);
		return "abc\n";
	};
	sandbox.inspectContainer = async () => ({
		Id: "abc",
		Config: { Labels: { "io.hubuum.sandbox.owner": "other" } },
	});
	await assert.rejects(sandbox.cleanup(), /ownership mismatch/);
	assert.equal(
		calls.some((call) => call.includes("rm")),
		false,
	);
	assert.ok(calls[0].includes("label=io.hubuum.sandbox.run=run"));
});

test("password changes resolve a local account and preserve the revision guard", async () => {
	const calls = [];
	const api = async (path, options) => {
		calls.push({ path, options });
		if (path.includes("?"))
			return {
				data: [
					{
						id: 4,
						name: "corpus-reader",
						identity_scope: "local",
						provider_managed: false,
					},
				],
				headers: new Headers(),
			};
		return { data: {}, headers: new Headers({ ETag: '"revision-7"' }) };
	};
	await setPassword(api, "corpus-reader", "chosen-test-password");
	assert.equal(calls.at(-1).path, "/api/v1/iam/users/4");
	assert.deepEqual(calls.at(-1).options, {
		method: "PATCH",
		body: { password: "chosen-test-password" },
		headers: { "If-Match": '"revision-7"' },
		allowed: [200, 204],
	});
	assert.throws(() => validatePassword("short"));
	assert.throws(() => validatePassword("long\npassword"));
});

test("password resets refuse unknown users and pagination cannot loop indefinitely", async () => {
	const empty = async () => ({ data: [], headers: new Headers() });
	await assert.rejects(
		setPassword(empty, "corpus-reader", "chosen-test-password"),
		/not found/,
	);
	const repeated = async () => ({
		data: [],
		headers: new Headers({ "X-Next-Cursor": "repeat" }),
	});
	await assert.rejects(
		pages(repeated, "/api/v1/iam/users"),
		/did not terminate/,
	);
});
