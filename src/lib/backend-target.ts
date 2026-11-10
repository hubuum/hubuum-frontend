import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";

function installationKey(name = "backend"): string {
	return `${getServerEnv().SETTINGS_PREFIX}installation:${name}`;
}

const targetSchema = z.object({
	origin: z.string().url(),
	revision: z.string().min(1),
});
export type BackendTarget = z.infer<typeof targetSchema>;
export type BackendCredential =
	| string
	| { token: string; target: BackendTarget };
const originId = (origin: string) =>
	createHash("sha256").update(origin).digest("hex");

export async function getBackendTarget(): Promise<BackendTarget | null> {
	const configured = getServerEnv().BACKEND_BASE_URL;
	if (configured)
		return {
			origin: new URL(configured).origin,
			revision: `environment:${originId(new URL(configured).origin)}`,
		};
	const stored = await getValkeyClient().get(installationKey());
	if (!stored) return null;
	// Upgrade the initial setup implementation without discarding its connection.
	if (/^https?:\/\//.test(stored))
		return {
			origin: new URL(stored).origin,
			revision: `legacy:${originId(new URL(stored).origin)}`,
		};
	return targetSchema.parse(JSON.parse(stored));
}

export async function getBackendBaseUrl(): Promise<string | null> {
	return (await getBackendTarget())?.origin ?? null;
}

export function sessionCredential(session: {
	token: string;
	backendOrigin?: string;
	backendRevision?: string;
}): BackendCredential {
	return session.backendOrigin && session.backendRevision
		? {
				token: session.token,
				target: {
					origin: session.backendOrigin,
					revision: session.backendRevision,
				},
			}
		: session.token;
}

export async function assertBackendTarget(
	target: BackendTarget,
): Promise<void> {
	const current = await getBackendTarget();
	if (current?.revision !== target.revision || current.origin !== target.origin)
		throw new Error("The console's server connection changed. Sign in again.");
}

// No expiry and no process cache: every replica sees the same one-time choice.
const SAVE_INITIAL_TARGET = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[2])
return 1
`;
export async function saveInitialBackend(origin: string): Promise<boolean> {
	if (getServerEnv().BACKEND_BASE_URL) return false;
	return (
		(await getValkeyClient().eval(
			SAVE_INITIAL_TARGET,
			2,
			installationKey(),
			installationKey("setup-key"),
			JSON.stringify({ origin, revision: randomUUID() }),
		)) === 1
	);
}

const CHANGE_TARGET = `
local raw = redis.call('GET', KEYS[1])
if not raw or raw ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;
export async function changeBackend(
	expected: BackendTarget,
	origin: string,
): Promise<boolean> {
	if (getServerEnv().BACKEND_BASE_URL) return false;
	const raw = expected.revision.startsWith("legacy:")
		? expected.origin
		: JSON.stringify(expected);
	return (
		(await getValkeyClient().eval(
			CHANGE_TARGET,
			1,
			installationKey(),
			raw,
			JSON.stringify({ origin, revision: randomUUID() }),
		)) === 1
	);
}

export async function getSetupKey(): Promise<string | null> {
	return (
		getServerEnv().SETUP_KEY ??
		(await getValkeyClient().get(installationKey("setup-key")))
	);
}

const ENSURE_SETUP_KEY = `
if redis.call('EXISTS', KEYS[1]) == 1 then return {} end
local key = redis.call('GET', KEYS[2])
if key then return {key, 0} end
redis.call('SET', KEYS[2], ARGV[1])
return {ARGV[1], 1}
`;
export async function initializeSetupKey(printExisting = false): Promise<void> {
	const env = getServerEnv();
	if (env.BACKEND_BASE_URL || env.SETUP_KEY) return;
	const result: unknown = await getValkeyClient().eval(
		ENSURE_SETUP_KEY,
		2,
		installationKey(),
		installationKey("setup-key"),
		randomBytes(32).toString("hex"),
	);
	if (
		Array.isArray(result) &&
		typeof result[0] === "string" &&
		(result[1] === 1 || printExisting)
	) {
		// Intentional, operator-requested bootstrap credential on stdout only.
		// Never print an explicitly configured key or print after setup completes.
		process.stdout.write(`[hubuum-setup] One-time setup key: ${result[0]}\n`);
	}
}

export async function getBackendSetupStatus(): Promise<
	"configured" | "available" | "unavailable"
> {
	try {
		if (await getBackendBaseUrl()) return "configured";
		await initializeSetupKey();
		return (await getSetupKey()) ? "available" : "unavailable";
	} catch {
		return "unavailable";
	}
}
