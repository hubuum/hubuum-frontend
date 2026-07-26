import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/generated/client", () => ({
	getApiV1Config: vi.fn(),
}));

import {
	fetchClientAuthenticationConfig,
	fetchClientConfig,
	fetchClientPaginationConfig,
	formatDefaultTokenLifetime,
	formatDefaultTokenLifetimeNote,
} from "@/lib/api/client-config";
import { getApiV1Config } from "@/lib/api/generated/client";

const clientConfig = {
	authentication: {
		default_token_lifetime_hours: 24,
	},
	pagination: {
		default_page_limit: 50,
		max_page_limit: 250,
	},
};

describe("client configuration", () => {
	beforeEach(() => {
		vi.mocked(getApiV1Config).mockReset();
	});

	it("loads the public configuration through the BFF client", async () => {
		vi.mocked(getApiV1Config).mockResolvedValue({
			data: clientConfig,
			status: 200,
			headers: new Headers(),
		});

		await expect(fetchClientConfig()).resolves.toEqual(clientConfig);
		expect(getApiV1Config).toHaveBeenCalledWith({ credentials: "include" });
	});

	it("projects pagination and authentication settings", async () => {
		vi.mocked(getApiV1Config).mockResolvedValue({
			data: clientConfig,
			status: 200,
			headers: new Headers(),
		});

		await expect(fetchClientPaginationConfig()).resolves.toEqual(
			clientConfig.pagination,
		);
		await expect(fetchClientAuthenticationConfig()).resolves.toEqual(
			clientConfig.authentication,
		);
	});

	it("treats unavailable public configuration as optional", async () => {
		vi.mocked(getApiV1Config).mockRejectedValue(new Error("unavailable"));

		await expect(fetchClientConfig()).resolves.toBeNull();
		await expect(fetchClientPaginationConfig()).resolves.toBeNull();
		await expect(fetchClientAuthenticationConfig()).resolves.toBeNull();
	});

	it("formats the configured token lifetime for mint forms", () => {
		expect(formatDefaultTokenLifetime(1)).toBe("1 hour");
		expect(formatDefaultTokenLifetime(24)).toBe("24 hours");
		expect(formatDefaultTokenLifetime(undefined)).toBeNull();
		expect(formatDefaultTokenLifetimeNote(1)).toBe(
			"Leave blank to use the server default lifetime of 1 hour.",
		);
		expect(formatDefaultTokenLifetimeNote(24)).toBe(
			"Leave blank to use the server default lifetime of 24 hours.",
		);
		expect(formatDefaultTokenLifetimeNote(undefined)).toBe(
			"Leave blank to use the server's configured default lifetime.",
		);
	});
});
