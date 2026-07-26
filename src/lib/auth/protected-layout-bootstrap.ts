import "server-only";

import { hasAdminAccess } from "@/lib/auth/admin";
import { getCurrentPrincipalId } from "@/lib/auth/current-principal";
import { loadUserSettingsSnapshotForPrincipal } from "@/lib/user-settings-server";
import type { UserSettingsSnapshot } from "@/lib/user-settings-types";

export const PROTECTED_LAYOUT_BOOTSTRAP_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 512;

export type ProtectedLayoutBootstrap = {
	canViewAdmin: boolean;
	initialSettings: UserSettingsSnapshot | null;
	principalId: number | null;
};

type CacheEntry = {
	expiresAt: number;
	value: Promise<ProtectedLayoutBootstrap>;
};

const bootstrapCache = new Map<string, CacheEntry>();

function pruneCache(now: number): void {
	for (const [sid, entry] of bootstrapCache) {
		if (entry.expiresAt <= now) {
			bootstrapCache.delete(sid);
		}
	}
}

function makeRoomForCacheEntry(): void {
	while (bootstrapCache.size >= MAX_CACHE_ENTRIES) {
		const oldestSid = bootstrapCache.keys().next().value;
		if (typeof oldestSid !== "string") {
			break;
		}
		bootstrapCache.delete(oldestSid);
	}
}

async function fetchProtectedLayoutBootstrap({
	correlationId,
	token,
}: {
	correlationId?: string;
	token: string;
}): Promise<ProtectedLayoutBootstrap> {
	const [canViewAdmin, principalId] = await Promise.all([
		hasAdminAccess(token, correlationId),
		getCurrentPrincipalId(token, correlationId).catch(() => null),
	]);
	const initialSettings = principalId
		? await loadUserSettingsSnapshotForPrincipal({
				principalId,
				token,
				correlationId,
			}).catch(() => null)
		: null;

	return {
		canViewAdmin,
		initialSettings,
		principalId,
	};
}

export function loadProtectedLayoutBootstrap({
	correlationId,
	sid,
	token,
}: {
	correlationId?: string;
	sid: string;
	token: string;
}): Promise<ProtectedLayoutBootstrap> {
	const now = Date.now();
	pruneCache(now);

	const cached = bootstrapCache.get(sid);
	if (cached && cached.expiresAt > now) {
		return cached.value;
	}

	makeRoomForCacheEntry();
	const value = fetchProtectedLayoutBootstrap({ correlationId, token });
	const entry = {
		expiresAt: now + PROTECTED_LAYOUT_BOOTSTRAP_TTL_MS,
		value,
	};
	bootstrapCache.set(sid, entry);
	void value.catch(() => {
		if (bootstrapCache.get(sid) === entry) {
			bootstrapCache.delete(sid);
		}
	});

	return value;
}

export function invalidateProtectedLayoutBootstrap(sid: string): void {
	bootstrapCache.delete(sid);
}
