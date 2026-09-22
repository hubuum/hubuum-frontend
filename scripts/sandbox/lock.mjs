import { randomUUID } from "node:crypto";
import * as filesystem from "node:fs/promises";
import { join } from "node:path";

import { requireValue } from "./core.mjs";

const BUSY =
	"Sandbox is busy. Stop its frontend with Ctrl-C before resume or down.";
const INVALID = "Invalid sandbox lock; inspect it before removing it.";
const OWNER = /^(\d+)-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const COLLISION = new Set(["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"]);

function requireDeadOwner(pid, probe) {
	requireValue(Number.isSafeInteger(pid) && pid > 0, INVALID);
	try {
		probe(pid, 0);
	} catch (error) {
		if (error.code === "ESRCH") return;
	}
	throw new Error(BUSY);
}

async function removeEmptyDirectory(path, fs) {
	try {
		await fs.rmdir(path);
	} catch (error) {
		// A new owner may already have atomically published a nonempty directory.
		if (!COLLISION.has(error.code) && error.code !== "ENOENT") throw error;
	}
}

async function removeOwner(path, owner, fs) {
	try {
		await fs.unlink(join(path, owner));
	} catch (error) {
		if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
	}
	await removeEmptyDirectory(path, fs);
}

async function recoverStaleLock(path, fs, probe) {
	let entries;
	try {
		entries = await fs.readdir(path);
	} catch (error) {
		if (error.code === "ENOENT") return;
		if (error.code !== "ENOTDIR") throw error;
		// Migrate old PID files. unlink cannot remove a replacement directory.
		try {
			requireDeadOwner(Number(await fs.readFile(path, "utf8")), probe);
			await fs.unlink(path);
		} catch (legacyError) {
			if (!["ENOENT", "EISDIR"].includes(legacyError.code)) throw legacyError;
		}
		return;
	}
	if (entries.length === 0) return removeEmptyDirectory(path, fs);
	const owner = entries.length === 1 && OWNER.exec(entries[0]);
	requireValue(owner, INVALID);
	requireDeadOwner(Number(owner[1]), probe);
	await removeOwner(path, entries[0], fs);
}

export async function lock(
	root,
	name,
	{ fs = filesystem, probe = process.kill } = {},
) {
	const directory = join(root, ".local", "sandbox-locks");
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${name}.lock`);
	const token = randomUUID();
	const owner = `${process.pid}-${token}`;
	const claim = join(directory, `${name}.${token}.claim`);
	await fs.mkdir(claim, { mode: 0o700 });
	try {
		await fs.writeFile(join(claim, owner), "", { flag: "wx", mode: 0o600 });
		// Publish the owner and lock together: a live lock is never an empty
		// directory, and rename cannot replace another owner's nonempty lock.
		try {
			await fs.rename(claim, path);
		} catch (error) {
			if (!COLLISION.has(error.code)) throw error;
			await recoverStaleLock(path, fs, probe);
			try {
				await fs.rename(claim, path);
			} catch (retryError) {
				if (COLLISION.has(retryError.code)) throw new Error(BUSY);
				throw retryError;
			}
		}
	} finally {
		await fs.rm(claim, { recursive: true, force: true });
	}
	// The unique marker fences delayed recovery and repeated release callbacks.
	return () => removeOwner(path, owner, fs);
}
