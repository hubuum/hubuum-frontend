import { afterEach, describe, expect, it, vi } from "vitest";
import { endBrowserSession } from "@/lib/logout";

describe("endBrowserSession", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});
	it("still signs out when saving preferences fails", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		await endBrowserSession(async () => {
			throw new Error("Settings unavailable");
		});
		expect(fetchMock).toHaveBeenCalledWith(
			"/_hubuum-bff/auth/logout",
			expect.objectContaining({ method: "POST", credentials: "include" }),
		);
	});
	it("does not let a stalled preference save block sign-out", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const logout = endBrowserSession(() => new Promise(() => undefined));
		await vi.advanceTimersByTimeAsync(750);
		await logout;
		expect(fetchMock).toHaveBeenCalledOnce();
	});
	it.each([403, 500, 502])("reports a failed sign-out (%s)", async (status) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status })),
		);
		await expect(endBrowserSession(async () => undefined)).rejects.toThrow(
			"Sign-out could not be completed",
		);
	});
	it("reports a network failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
		);
		await expect(endBrowserSession(async () => undefined)).rejects.toThrow();
	});
});
