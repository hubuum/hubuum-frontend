import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/backend", () => ({
	backendFetchJson: vi.fn(),
}));

import { backendFetchJson } from "@/lib/api/backend";
import { fetchServerVersion } from "@/lib/server-version";

describe("connected server version", () => {
	beforeEach(() => {
		vi.mocked(backendFetchJson).mockReset();
	});

	it.each(["0.0.11", "v0.0.12-3-gabcdef0-dirty"])(
		"preserves the reported version %s",
		async (version) => {
			vi.mocked(backendFetchJson).mockResolvedValue({ info: { version } });
			await expect(fetchServerVersion("about-request")).resolves.toBe(version);
			expect(backendFetchJson).toHaveBeenCalledExactlyOnceWith(
				"/api-doc/openapi.json",
				{
					correlationId: "about-request",
					signal: expect.any(AbortSignal),
				},
			);
		},
	);

	it.each([
		null,
		{},
		{ info: null },
		{ info: "invalid" },
		{ info: {} },
		{ info: { version: 12 } },
		{ info: { version: " " } },
	])("handles malformed discovery: %j", async (document) => {
		vi.mocked(backendFetchJson).mockResolvedValue(document);
		await expect(fetchServerVersion()).resolves.toBeNull();
	});

	it.each([
		new Error("HTTP 404"),
		new Error("HTTP 503"),
		new DOMException("Timeout", "TimeoutError"),
	])("keeps discovery failures optional: %s", async (error) => {
		vi.mocked(backendFetchJson).mockRejectedValue(error);
		await expect(fetchServerVersion()).resolves.toBeNull();
	});
});
