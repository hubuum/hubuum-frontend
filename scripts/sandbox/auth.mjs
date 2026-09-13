import { emitKeypressEvents } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

import { requireValue } from "./core.mjs";

export async function waitFor(label, operation, signal, timeout = 180_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		signal?.throwIfAborted();
		if (await operation()) return;
		await delay(500, undefined, { signal });
	}
	throw new Error(
		`${label} did not become ready within ${timeout / 1000} seconds.`,
	);
}

export function apiClient(base, token, signal) {
	return async (
		path,
		{ method = "GET", body, headers = {}, allowed = [200] } = {},
	) => {
		const response = await fetch(`${base}${path}`, {
			method,
			redirect: "error",
			signal: signal
				? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
				: AbortSignal.timeout(30_000),
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...headers,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		requireValue(
			allowed.includes(response.status),
			`Sandbox API ${method} ${path.split("?")[0]} failed (HTTP ${response.status}).`,
		);
		const raw = await response.text();
		return { data: raw ? JSON.parse(raw) : null, headers: response.headers };
	};
}

export async function withAdmin(sandbox, signal, operation) {
	const base = `http://127.0.0.1:${sandbox.state.backendPort}`;
	const output = await sandbox.admin(["--reset-password", "admin"], { signal });
	const match = /^Password for user admin reset to: (\S+)\s*$/m.exec(output);
	requireValue(
		match,
		"Could not capture the disposable administrator credential.",
	);
	const { data } = await apiClient(
		base,
		undefined,
		signal,
	)("/api/v0/auth/login", {
		method: "POST",
		body: { name: "admin", password: match[1] },
	});
	requireValue(
		typeof data?.token === "string" && data.token.length > 0,
		"Administrator login did not return a token.",
	);
	const api = apiClient(base, data.token, signal);
	try {
		return await operation(api);
	} finally {
		// Revoke even when the setup operation was interrupted.
		await apiClient(base, data.token)("/api/v0/auth/logout", {
			method: "POST",
			allowed: [200, 204, 401],
		}).catch(() => {});
	}
}

export async function pages(api, path) {
	const result = [];
	const seen = new Set();
	let cursor;
	do {
		const query = new URLSearchParams({ limit: "100", include_total: "false" });
		if (cursor) query.set("cursor", cursor);
		const response = await api(`${path}?${query}`);
		requireValue(
			Array.isArray(response.data),
			"Unexpected sandbox list response.",
		);
		result.push(...response.data);
		cursor = response.headers.get("x-next-cursor");
		requireValue(
			!cursor || (!seen.has(cursor) && seen.size < 100),
			"Sandbox pagination did not terminate.",
		);
		seen.add(cursor);
	} while (cursor);
	return result;
}

export async function setPassword(api, username, password) {
	const users = await pages(api, "/api/v1/iam/users");
	const user = users.find(
		(entry) => entry.name === username && entry.identity_scope === "local",
	);
	requireValue(
		user && !user.provider_managed && Number.isSafeInteger(user.id),
		`Local sandbox user '${username}' was not found.`,
	);
	const path = `/api/v1/iam/users/${user.id}`;
	const current = await api(path);
	requireValue(
		current.headers.get("etag"),
		"User response has no revision guard.",
	);
	await api(path, {
		method: "PATCH",
		body: { password },
		headers: { "If-Match": current.headers.get("etag") },
		allowed: [200, 204],
	});
}

export async function verifyCorpus(api, corpus, signal) {
	const classes = await pages(api, "/api/v1/classes");
	requireValue(
		classes.length === corpus.manifest.state_counts.classes,
		"Restored class count differs from the corpus manifest.",
	);
	const objects = new Map();
	for (const spec of corpus.recipe.classes) {
		const id = corpus.manifest.anchors.classes[spec.name];
		requireValue(
			classes.some((row) => row.id === id && row.name === spec.name),
			"Restored class anchor mismatch.",
		);
		const rows = await pages(api, `/api/v1/classes/${id}/`);
		requireValue(
			rows.length === spec.objects &&
				new Set(rows.map((row) => row.id)).size === rows.length,
			`Restored object count mismatch for ${spec.name}.`,
		);
		objects.set(spec.name, new Map(rows.map((row) => [row.name, row.id])));
		if (spec.policy === "enforced")
			await waitFor(
				`Schema revalidation for ${spec.name}`,
				async () => {
					const { data } = await api(`/api/v1/classes/${id}/schema`);
					return (
						data.counts?.valid === spec.objects &&
						data.counts.invalid === 0 &&
						data.counts.pending === 0
					);
				},
				signal,
			);
	}
	for (const example of corpus.recipe.computed?.examples ?? []) {
		const spec = corpus.recipe.classes.find(
			(entry) => entry.name === example.class,
		);
		const name = `${example.class}-${String(example.number).padStart(4, "0")}${spec.policy === "advisory" && example.number % 2 === 0 ? "-nonconforming" : ""}`;
		const id = objects.get(example.class)?.get(name);
		requireValue(id, "Computed example object is missing.");
		await waitFor(
			`Computed rebuilding for ${name}`,
			async () => {
				const { data } = await api(
					`/api/v1/classes/${corpus.manifest.anchors.classes[example.class]}/${id}?include=computed`,
				);
				const shared = data.computed?.shared;
				if (shared?.materialization_stale !== false) return false;
				for (const [key, value] of Object.entries(example.values))
					requireValue(
						isDeepStrictEqual(shared.values[key], value),
						`Computed example ${name}.${key} differs from the corpus recipe.`,
					);
				const actualErrors = Object.fromEntries(
					Object.entries(shared.errors ?? {}).map(([key, value]) => [
						key,
						value.code,
					]),
				);
				requireValue(
					Object.keys(actualErrors).length ===
						Object.keys(example.errors).length &&
						Object.entries(example.errors).every(
							([key, value]) => actualErrors[key] === value,
						),
					`Computed errors differ for ${name}.`,
				);
				return true;
			},
			signal,
		);
	}
}

export function validatePassword(password) {
	requireValue(
		password.length >= 8 &&
			Buffer.byteLength(password) <= 1024 &&
			!/[\r\n\0]/.test(password),
		"Choose a password of at least 8 characters and at most 1,024 bytes, without line breaks.",
	);
	return password;
}

export async function hiddenPrompt(
	label,
	signal,
	{ input = process.stdin, output = process.stderr } = {},
) {
	signal?.throwIfAborted();
	requireValue(
		input.isTTY,
		"A terminal is required for the password prompt. Use --password-stdin for automation.",
	);
	emitKeypressEvents(input);
	const previousRaw = input.isRaw;
	input.setRawMode(true);
	try {
		return await new Promise((resolve, reject) => {
			let value = "";
			const finish = (error) => {
				input.removeListener("keypress", keypress);
				signal?.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(value);
			};
			const abort = () => finish(new Error("Password entry interrupted."));
			const keypress = (text, key = {}) => {
				if (key.ctrl && key.name === "c") return abort();
				if (key.name === "return" || key.name === "enter") return finish();
				if (key.name === "backspace")
					value = Array.from(value).slice(0, -1).join("");
				else if (!key.ctrl && !key.meta && text && !text.includes("\x1b"))
					value += text;
				if (Buffer.byteLength(value) > 1024)
					finish(new Error("Password is too long."));
			};
			input.on("keypress", keypress);
			signal?.addEventListener("abort", abort, { once: true });
			// Enable hidden input before displaying the prompt, including for
			// fast paste/automation that responds immediately to the label.
			output.write(label);
			input.resume();
		});
	} finally {
		input.setRawMode(previousRaw ?? false);
		input.pause();
		output.write("\n");
	}
}

export async function readPassword(stream, signal) {
	signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		let value = "";
		const finish = (error) => {
			stream.pause();
			stream.removeListener("data", data);
			stream.removeListener("end", end);
			stream.removeListener("error", failed);
			signal?.removeEventListener("abort", abort);
			if (error) reject(error);
			else {
				try {
					resolve(validatePassword(value.replace(/\r?\n$/, "")));
				} catch (invalid) {
					reject(invalid);
				}
			}
		};
		const abort = () => finish(new Error("Password entry interrupted."));
		const failed = () => finish(new Error("Could not read password input."));
		const end = () => finish();
		const data = (chunk) => {
			value += chunk;
			if (Buffer.byteLength(value) > 1026)
				finish(new Error("Password input is too long."));
		};
		stream.setEncoding("utf8");
		stream.on("data", data);
		stream.once("end", end);
		stream.once("error", failed);
		signal?.addEventListener("abort", abort, { once: true });
	});
}

export async function passwordInput(options, signal) {
	if (options["password-stdin"]) return readPassword(process.stdin, signal);
	const first = await hiddenPrompt(
		`New password for ${options.user}: `,
		signal,
	);
	const second = await hiddenPrompt("Repeat password: ", signal);
	requireValue(first === second, "Passwords did not match.");
	return validatePassword(first);
}
