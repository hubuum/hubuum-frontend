import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
	getCurrentPrincipalId: vi.fn(),
	hasAdminAccess: vi.fn(),
	loadUserSettingsSnapshotForPrincipal: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
	hasAdminAccess: dependencies.hasAdminAccess,
}));
vi.mock("@/lib/auth/current-principal", () => ({
	getCurrentPrincipalId: dependencies.getCurrentPrincipalId,
}));
vi.mock("@/lib/user-settings-server", () => ({
	loadUserSettingsSnapshotForPrincipal:
		dependencies.loadUserSettingsSnapshotForPrincipal,
}));

import {
	invalidateProtectedLayoutBootstrap,
	loadProtectedLayoutBootstrap,
	PROTECTED_LAYOUT_BOOTSTRAP_TTL_MS,
} from "@/lib/auth/protected-layout-bootstrap";

const snapshot = {
	principalId: 17,
	schemaVersion: 1,
	settings: { theme: "dark" },
};

describe("protected layout bootstrap cache", () => {
	beforeEach(() => {
		dependencies.getCurrentPrincipalId.mockReset();
		dependencies.hasAdminAccess.mockReset();
		dependencies.loadUserSettingsSnapshotForPrincipal.mockReset();
	});

	it("coalesces concurrent loads and reuses the result for a session", async () => {
		let resolvePrincipal: ((principalId: number) => void) | undefined;
		dependencies.hasAdminAccess.mockResolvedValue(true);
		dependencies.getCurrentPrincipalId.mockImplementation(
			() =>
				new Promise<number>((resolve) => {
					resolvePrincipal = resolve;
				}),
		);
		dependencies.loadUserSettingsSnapshotForPrincipal.mockResolvedValue(
			snapshot,
		);

		const first = loadProtectedLayoutBootstrap({
			correlationId: "first-request",
			sid: "concurrent-session",
			token: "backend-token",
		});
		const second = loadProtectedLayoutBootstrap({
			correlationId: "second-request",
			sid: "concurrent-session",
			token: "backend-token",
		});

		expect(second).toBe(first);
		expect(dependencies.getCurrentPrincipalId).toHaveBeenCalledTimes(1);
		expect(dependencies.hasAdminAccess).toHaveBeenCalledTimes(1);

		resolvePrincipal?.(17);
		await expect(first).resolves.toEqual({
			canViewAdmin: true,
			initialSettings: snapshot,
			principalId: 17,
		});
		expect(
			dependencies.loadUserSettingsSnapshotForPrincipal,
		).toHaveBeenCalledTimes(1);
	});

	it("loads fresh data after the short cache lifetime", async () => {
		let now = 10_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		dependencies.hasAdminAccess.mockResolvedValue(false);
		dependencies.getCurrentPrincipalId.mockResolvedValue(17);
		dependencies.loadUserSettingsSnapshotForPrincipal.mockResolvedValue(
			snapshot,
		);

		await loadProtectedLayoutBootstrap({
			sid: "expiring-session",
			token: "backend-token",
		});
		now += PROTECTED_LAYOUT_BOOTSTRAP_TTL_MS - 1;
		await loadProtectedLayoutBootstrap({
			sid: "expiring-session",
			token: "backend-token",
		});
		expect(dependencies.getCurrentPrincipalId).toHaveBeenCalledTimes(1);

		now += 2;
		await loadProtectedLayoutBootstrap({
			sid: "expiring-session",
			token: "backend-token",
		});
		expect(dependencies.getCurrentPrincipalId).toHaveBeenCalledTimes(2);

		vi.restoreAllMocks();
	});

	it("can be invalidated immediately after session or settings changes", async () => {
		dependencies.hasAdminAccess.mockResolvedValue(false);
		dependencies.getCurrentPrincipalId.mockResolvedValue(17);
		dependencies.loadUserSettingsSnapshotForPrincipal.mockResolvedValue(
			snapshot,
		);

		await loadProtectedLayoutBootstrap({
			sid: "invalidated-session",
			token: "backend-token",
		});
		invalidateProtectedLayoutBootstrap("invalidated-session");
		await loadProtectedLayoutBootstrap({
			sid: "invalidated-session",
			token: "backend-token",
		});

		expect(dependencies.getCurrentPrincipalId).toHaveBeenCalledTimes(2);
		expect(dependencies.hasAdminAccess).toHaveBeenCalledTimes(2);
		expect(
			dependencies.loadUserSettingsSnapshotForPrincipal,
		).toHaveBeenCalledTimes(2);
	});
});
