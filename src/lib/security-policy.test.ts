import { describe, expect, it } from "vitest";
import {
	buildContentSecurityPolicy,
	protectPrivateResponse,
	REPORT_SANDBOX_POLICY,
} from "@/lib/security-policy";

describe("response security", () => {
	it.each([
		"text/html;charset=utf-8",
		"application/xhtml+xml",
		"image/svg+xml",
	])("isolates %s and prevents private output caching", (contentType) => {
		const headers = new Headers({
			"Content-Type": contentType,
			"Cache-Control": "public, max-age=3600",
		});
		protectPrivateResponse(headers);
		expect(headers.get("content-security-policy")).toBe(REPORT_SANDBOX_POLICY);
		expect(headers.get("cache-control")).toBe("private, no-store");
		expect(headers.get("content-type")).toBe(contentType);
	});
	it("keeps downloads and safe content types intact", () => {
		const headers = new Headers({
			"Content-Type": "text/csv",
			"Content-Disposition": 'attachment; filename="report.csv"',
		});
		protectPrivateResponse(headers);
		expect(headers.get("content-disposition")).toContain("report.csv");
		expect(headers.get("content-security-policy")).toBeNull();
		expect(headers.get("cache-control")).toBe("private, no-store");
	});
	it("requires a nonce for production scripts and limits browser connections to the BFF origin", () => {
		const policy = buildContentSecurityPolicy("test-nonce", false);
		const scripts = policy
			.split(";")
			.find((part) => part.includes("script-src"));
		expect(scripts).toContain("'nonce-test-nonce'");
		expect(scripts).not.toContain("unsafe-inline");
		expect(scripts).not.toContain("unsafe-eval");
		expect(policy).toContain("connect-src 'self'");
		expect(buildContentSecurityPolicy("dev", true)).toContain("unsafe-eval");
	});
});
