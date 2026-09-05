import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

afterEach(() => vi.restoreAllMocks());

describe("document security policy", () => {
	it("replaces caller-controlled nonce and policy headers with a fresh matching pair", () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const request = new NextRequest("https://console.example/classes", {
			headers: {
				"x-hubuum-nonce": "untrusted",
				"Content-Security-Policy": "default-src *",
				accept: "text/html",
			},
		});
		const first = proxy(request);
		const second = proxy(request);
		const nonce = first.headers.get("x-middleware-request-x-hubuum-nonce");
		expect(nonce).toBeTruthy();
		expect(nonce).not.toBe("untrusted");
		expect(first.headers.get("Content-Security-Policy")).toContain(
			`'nonce-${nonce}'`,
		);
		expect(
			first.headers.get("x-middleware-request-content-security-policy"),
		).toBe(first.headers.get("Content-Security-Policy"));
		expect(second.headers.get("x-middleware-request-x-hubuum-nonce")).not.toBe(
			nonce,
		);
		expect(first.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("marks even error-capable BFF routes private before their handlers run", () => {
		vi.spyOn(console, "info").mockImplementation(() => {});
		const response = proxy(
			new NextRequest("https://console.example/_hubuum-bff/auth/session"),
		);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});
});
