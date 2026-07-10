import { describe, expect, it } from "vitest";

import {
	getLoginProviderOptions,
	normalizeAuthProvidersResponse,
	selectAvailableProvider,
} from "@/lib/auth-providers";

describe("authentication provider discovery", () => {
	it("normalizes and deduplicates a valid response", () => {
		expect(
			normalizeAuthProvidersResponse({
				providers: ["local", " directory ", "directory"],
			}),
		).toEqual({ providers: ["local", "directory"] });
	});

	it("rejects malformed responses", () => {
		expect(normalizeAuthProvidersResponse(null)).toBeNull();
		expect(normalizeAuthProvidersResponse({ providers: "local" })).toBeNull();
		expect(
			normalizeAuthProvidersResponse({ providers: ["local", 42] }),
		).toBeNull();
		expect(normalizeAuthProvidersResponse({ providers: [] })).toEqual({
			providers: [],
		});
	});

	it("keeps local login available and selects a valid remembered scope", () => {
		const providers = getLoginProviderOptions(["directory"]);
		expect(providers).toEqual(["local", "directory"]);
		expect(selectAvailableProvider(providers, "directory")).toBe("directory");
		expect(selectAvailableProvider(providers, "retired-scope")).toBe("local");
	});
});
