import { describe, expect, it } from "vitest";

import {
	backupFilenameFromHeader,
	parseBackupDocument,
} from "@/lib/api/backup-restore";

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
