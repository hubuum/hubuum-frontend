import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { readJson, requireValue } from "./core.mjs";
import { checkDevelopmentProcess } from "./runtime.mjs";

async function inspectProcess(pid, retries = 5) {
	const directory = `/proc/${pid}`;
	try {
		const stat = await readFile(join(directory, "stat"), "utf8");
		// The command name can contain spaces and parentheses.
		const fields = stat
			.slice(stat.lastIndexOf(")") + 2)
			.trim()
			.split(/\s+/);
		if (fields[0] === "Z" || fields[0] === "X") return null;
		const [cwd, args, environment] = await Promise.all([
			realpath(join(directory, "cwd")),
			readFile(join(directory, "cmdline"), "utf8"),
			readFile(join(directory, "environ"), "utf8"),
		]);
		return {
			pid,
			parent: Number(fields[1]),
			group: Number(fields[2]),
			started: fields[19],
			cwd,
			args: args.split("\0"),
			// Keep only the non-secret run identifiers, never process credentials.
			markers: environment
				.split("\0")
				.filter((entry) => /^(SESSION_PREFIX|SETTINGS_PREFIX)=/.test(entry)),
		};
	} catch (error) {
		if (error.code === "ENOENT" || error.code === "ESRCH") return null;
		// During exit Linux can deny metadata access before marking the process
		// as a zombie. Retry briefly; a persistent permission error stays fatal.
		if (retries > 0 && (error.code === "EACCES" || error.code === "EPERM")) {
			await delay(20);
			return inspectProcess(pid, retries - 1);
		}
		throw error;
	}
}

export async function stopOrphanedFrontend(
	root,
	state,
	{
		inspect = inspectProcess,
		kill = process.kill,
		wait = delay,
		platform = process.platform,
		timeout = 5000,
	} = {},
) {
	// The caller holds the sandbox run lock: a live launcher still owns shutdown.
	if (platform !== "linux") return checkDevelopmentProcess(root);
	let info;
	try {
		info = await readJson(join(root, ".next/dev/lock"));
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw new Error(
			"Cannot read the Next.js development lock. Stop the frontend before running down.",
		);
	}
	if (!Number.isSafeInteger(info?.pid) || info.pid <= 0)
		throw new Error(
			"Cannot identify the Next.js development process. Stop the frontend before running down.",
		);
	root = await realpath(root);
	const manual = `Next.js development process (PID ${info.pid}) could not be verified as this sandbox's frontend. Stop it with Ctrl-C before running down.`;
	const inspectSafely = async (pid) => {
		try {
			return await inspect(pid);
		} catch (error) {
			throw new Error(
				`${manual} Process inspection: ${error.code ?? "unavailable"}.`,
			);
		}
	};
	const frontend = await inspectSafely(info.pid);
	if (!frontend) return;
	const belongsToSandbox = (candidate) =>
		candidate?.cwd === root &&
		candidate.markers.includes(
			`SESSION_PREFIX=sandbox:${state.run}:session:`,
		) &&
		candidate.markers.includes(
			`SETTINGS_PREFIX=sandbox:${state.run}:settings:`,
		);
	// A frontend for another sandbox or ordinary npm run dev does not use this
	// sandbox's dependencies and must neither be stopped nor prevent removal.
	if (!belongsToSandbox(frontend)) return;
	const parent = await inspectSafely(frontend.parent);
	requireValue(
		belongsToSandbox(parent) &&
			parent.group === parent.pid &&
			frontend.group === parent.pid &&
			typeof parent.args[1] === "string" &&
			resolve(root, parent.args[1]) === join(root, "scripts/dev-server.mjs"),
		`${manual} Parent identity did not match.`,
	);
	const remaining = async () => {
		const active = [];
		for (const original of [parent, frontend]) {
			const current = await inspectSafely(original.pid);
			if (!current || current.started !== original.started) continue;
			requireValue(
				belongsToSandbox(current) && current.group === parent.pid,
				manual,
			);
			active.push(current);
		}
		return active.length > 0;
	};
	const signal = async (kind) => {
		// Recheck identity before each signal, including escalation after a timeout.
		if (!(await remaining())) return;
		try {
			kill(-parent.pid, kind);
		} catch (error) {
			if (error.code !== "ESRCH") throw new Error(manual);
		}
	};
	console.info(
		`[sandbox] Stopping orphaned frontend for '${state.name}' (PID ${frontend.pid}).`,
	);
	await signal("SIGTERM");
	for (const [duration, nextSignal] of [
		[timeout, "SIGKILL"],
		[2000, null],
	]) {
		for (let elapsed = 0; elapsed < duration; elapsed += 50) {
			if (!(await remaining())) return;
			await wait(50);
		}
		if (nextSignal) await signal(nextSignal);
	}
	requireValue(
		!(await remaining()),
		"The sandbox frontend did not stop. Its containers and data have been retained.",
	);
}
