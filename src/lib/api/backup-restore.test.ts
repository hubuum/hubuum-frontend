import { afterEach, describe, expect, it, vi } from "vitest";

import {
	backupFilenameFromHeader,
	confirmRestore,
	isTerminalRestoreStatus,
	parseBackupDocument,
} from "@/lib/api/backup-restore";

afterEach(() => vi.unstubAllGlobals());

describe("asynchronous restore", () => {
	it("accepts queued confirmation and preserves the capability only in the request body", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				Response.json({ id: 42, status: "confirmed" }, { status: 202 }),
			);
		vi.stubGlobal("fetch", fetch);
		await expect(
			confirmRestore(42, "restore-capability", "backup-sha"),
		).resolves.toMatchObject({ status: "confirmed" });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe("/_hubuum-bff/hubuum/api/v1/restores/42/confirm");
		expect(JSON.parse(init.body)).toMatchObject({
			restore_capability: "restore-capability",
			sha256: "backup-sha",
		});
	});

	it("surfaces a rejected confirmation", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ message: "Stage expired" }, { status: 410 }),
				),
		);
		await expect(confirmRestore(42, "capability", "sha")).rejects.toThrow(
			"Stage expired",
		);
	});

	it.each(["validated", "confirmed"] as const)(
		"keeps polling %s restores",
		(status) => {
			expect(isTerminalRestoreStatus(status)).toBe(false);
		},
	);
	it.each(["succeeded", "failed", "expired"] as const)(
		"stops polling %s restores",
		(status) => {
			expect(isTerminalRestoreStatus(status)).toBe(true);
		},
	);
});

describe("parseBackupDocument", () => {
	it("accepts a backup-shaped JSON object", () => {
		expect(parseBackupDocument('{"backup_version":3}').backup_version).toBe(3);
	});

	it("rejects invalid JSON and non-backup values", () => {
		expect(() => parseBackupDocument("not json")).toThrow("not valid JSON");
		expect(() => parseBackupDocument("[]")).toThrow("not a Hubuum backup");
	});
});

describe("backupFilenameFromHeader", () => {
	it("uses a safe server filename", () => {
		expect(
			backupFilenameFromHeader('attachment; filename="hubuum-backup.json"', 42),
		).toBe("hubuum-backup.json");
	});

	it("drops path components and falls back for non-json names", () => {
		expect(
			backupFilenameFromHeader('attachment; filename="../backup.json"', 42),
		).toBe("backup.json");
		expect(backupFilenameFromHeader(null, 42)).toBe("hubuum-backup-42.json");
	});
});
