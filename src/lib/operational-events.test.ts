import { describe, expect, it } from "vitest";

import {
	formatOperationalEvent,
	operationalErrorFields,
	operationalLevelForStatus,
	redactOperationalText,
	sanitizeOperationalPath,
} from "@/lib/operational-events";

describe("operational event formatting", () => {
	it("emits a stable JSON-compatible envelope", () => {
		const event = formatOperationalEvent(
			"info",
			"backend.request.completed",
			{
				status: 200,
				method: "GET",
				duration_ms: 12,
				correlation_id: "test-correlation",
			},
			() => new Date("2026-08-03T10:00:00.000Z"),
		);

		expect(event).toEqual({
			timestamp: "2026-08-03T10:00:00.000Z",
			level: "info",
			service: "hubuum-frontend",
			event: "backend.request.completed",
			correlation_id: "test-correlation",
			duration_ms: 12,
			method: "GET",
			status: 200,
		});
	});

	it("drops sensitive and structured fields", () => {
		const event = formatOperationalEvent("warn", "test.redaction", {
			api_key: "secret",
			authorization: "Bearer secret",
			body: "sensitive request",
			cookie: "hubuum.sid=secret",
			password: "secret",
			payload: { nested: "data" },
			response_headers: { server: "example" },
			session_id: "secret",
			token: "secret",
			safe: true,
		});

		expect(event.safe).toBe(true);
		expect(event).not.toHaveProperty("api_key");
		expect(event).not.toHaveProperty("authorization");
		expect(event).not.toHaveProperty("body");
		expect(event).not.toHaveProperty("cookie");
		expect(event).not.toHaveProperty("password");
		expect(event).not.toHaveProperty("payload");
		expect(event).not.toHaveProperty("response_headers");
		expect(event).not.toHaveProperty("session_id");
		expect(event).not.toHaveProperty("token");
	});

	it("redacts credentials embedded in otherwise safe strings", () => {
		expect(
			redactOperationalText(
				"request failed: Bearer abc123 token=hidden&mode=full password: hunter2",
			),
		).toBe(
			"request failed: Bearer [redacted] token=[redacted]&mode=full password=[redacted]",
		);
	});

	it("truncates oversized strings and normalizes non-finite numbers", () => {
		const event = formatOperationalEvent("info", "test.bounds", {
			message: "x".repeat(700),
			value: Number.POSITIVE_INFINITY,
		});

		expect(String(event.message)).toHaveLength(512);
		expect(String(event.message).endsWith("…")).toBe(true);
		expect(event.value).toBeNull();
	});

	it("rejects invalid event and field names", () => {
		expect(() => formatOperationalEvent("info", "Invalid Event")).toThrow();
		const event = formatOperationalEvent("info", "valid.event", {
			"not valid": "ignored",
		});
		expect(event).not.toHaveProperty("not valid");
	});
});

describe("operational path sanitization", () => {
	it("retains query names while redacting every value", () => {
		expect(
			sanitizeOperationalPath(
				"api/v1/objects?query=name%3DPrivate&cursor=opaque&cursor=second",
			),
		).toBe(
			"/api/v1/objects?query=[redacted]&cursor=[redacted]&cursor=[redacted]",
		);
	});

	it("redacts credential-bearing path segments and fragments", () => {
		expect(
			sanitizeOperationalPath(
				"/api/v0/auth/logout/token/raw-secret#not-for-logs",
			),
		).toBe("/api/v0/auth/logout/token/[redacted]");
		expect(
			sanitizeOperationalPath(
				"/_hubuum-bff/hubuum/api/v0/auth/logout/token/raw-secret",
			),
		).toBe(
			"/_hubuum-bff/hubuum/api/v0/auth/logout/token/[redacted]",
		);
	});
});

describe("operational error and level helpers", () => {
	it("captures bounded error identity without a stack", () => {
		const fields = operationalErrorFields(
			new TypeError("token=abc could not be parsed"),
		);
		const event = formatOperationalEvent("error", "backend.request.failed", fields);

		expect(event.error_name).toBe("TypeError");
		expect(event.error_message).toBe("token=[redacted] could not be parsed");
		expect(event).not.toHaveProperty("stack");
	});

	it("maps HTTP status families to log levels", () => {
		expect(operationalLevelForStatus(204)).toBe("info");
		expect(operationalLevelForStatus(404)).toBe("warn");
		expect(operationalLevelForStatus(503)).toBe("error");
	});
});
