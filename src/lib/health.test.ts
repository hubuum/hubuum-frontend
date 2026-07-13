import { describe, expect, it, vi } from "vitest";

import { checkReadiness } from "@/lib/health";

describe("checkReadiness", () => {
	it("reports ready when the backend and configured Valkey are healthy", async () => {
		const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
		const pingValkey = vi.fn(async () => undefined);

		const result = await checkReadiness({
			backendBaseUrl: "http://hubuum.test:8080",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			pingValkey,
		});

		expect(result).toEqual({
			ready: true,
			dependencies: { backend: "ok", valkey: "ok" },
		});
		expect(fetchImpl).toHaveBeenCalledWith(
			new URL("http://hubuum.test:8080/readyz"),
			expect.objectContaining({ method: "GET" }),
		);
		expect(pingValkey).toHaveBeenCalledOnce();
	});

	it("reports unavailable when Valkey is unhealthy", async () => {
		const result = await checkReadiness({
			backendBaseUrl: "http://hubuum.test:8080",
			fetchImpl: vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch,
			pingValkey: vi.fn(async () => {
				throw new Error("unavailable");
			}),
		});

		expect(result).toEqual({
			ready: false,
			dependencies: { backend: "ok", valkey: "error" },
		});
	});

	it("reports unavailable without exposing dependency errors", async () => {
		const result = await checkReadiness({
			backendBaseUrl: "http://hubuum.test:8080",
			fetchImpl: vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
			pingValkey: vi.fn(async () => {
				throw new Error("redis://user:secret@valkey:6379");
			}),
		});

		expect(result).toEqual({
			ready: false,
			dependencies: { backend: "error", valkey: "error" },
		});
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});
