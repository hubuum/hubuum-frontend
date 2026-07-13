import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/backend", () => {
	class BackendError extends Error {
		constructor(
			message: string,
			readonly status: number,
			readonly payload: unknown,
		) {
			super(message);
		}
	}

	return { BackendError, backendFetchJson: vi.fn() };
});

import { BackendError, backendFetchJson } from "@/lib/api/backend";
import {
	fetchRunningConfig,
	tryFetchRunningConfig,
	tryFetchSystemMetaSnapshot,
} from "@/lib/meta";

describe("system metadata", () => {
	beforeEach(() => {
		vi.mocked(backendFetchJson).mockReset();
	});

	it("loads the redacted runtime configuration with the admin token", async () => {
		const config = { server: { actix_workers: 4 } };
		vi.mocked(backendFetchJson).mockResolvedValueOnce(config);

		await expect(fetchRunningConfig("token", "correlation")).resolves.toBe(
			config,
		);
		expect(backendFetchJson).toHaveBeenCalledWith("/api/v1/admin/config", {
			correlationId: "correlation",
			token: "token",
		});
	});

	it.each([
		401, 403, 404,
	])("treats status %s as an unavailable optional configuration", async (status) => {
		vi.mocked(backendFetchJson).mockRejectedValueOnce(
			new BackendError("unavailable", status, null),
		);

		await expect(tryFetchRunningConfig("token")).resolves.toBeNull();
	});

	it("does not hide unexpected configuration failures", async () => {
		const error = new BackendError("failed", 500, null);
		vi.mocked(backendFetchJson).mockRejectedValueOnce(error);

		await expect(tryFetchRunningConfig("token")).rejects.toBe(error);
	});

	it("keeps the system snapshot available when an older backend lacks config", async () => {
		const counts = { total_classes: 1, total_objects: 2 };
		const db = { db_size: 3 };
		const tasks = { total_tasks: 4 };
		vi.mocked(backendFetchJson).mockImplementation(async (path) => {
			if (path === "/api/v1/admin/config") {
				throw new BackendError("not found", 404, null);
			}
			if (path === "/api/v0/meta/counts") return counts;
			if (path === "/api/v0/meta/db") return db;
			if (path === "/api/v0/meta/tasks") return tasks;
			throw new Error(`Unexpected path: ${path}`);
		});

		await expect(tryFetchSystemMetaSnapshot("token")).resolves.toEqual({
			config: null,
			counts,
			db,
			tasks,
		});
	});
});
