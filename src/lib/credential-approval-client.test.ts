import { afterEach, describe, expect, it, vi } from "vitest";

import {
	fetchWithCredentialApproval,
	registerCredentialConfirmation,
} from "@/lib/credential-approval-client";
import {
	credentialOperation,
	credentialOperationSummary,
} from "@/lib/credential-operation";

const url = new URL(
	"https://console.example/_hubuum-bff/hubuum/api/v1/iam/principals/42/tokens",
);
const rejection = () =>
	Response.json({ reason: "reauthentication_required" }, { status: 403 });
let unregister = () => {};
afterEach(() => unregister());

describe("optional credential reauthentication", () => {
	it.each([201, 400, 401, 403, 404, 429, 500])(
		"preserves existing status %s without probing or prompting",
		async (status) => {
			const response = Response.json(
				{ message: "Existing behavior" },
				{ status },
			);
			const fetcher = vi.fn().mockResolvedValue(response);
			const handler = vi.fn();
			unregister = registerCredentialConfirmation(handler);
			expect(
				await fetchWithCredentialApproval(fetcher, url, url, {
					method: "POST",
					body: "{}",
				}),
			).toBe(response);
			expect(handler).not.toHaveBeenCalled();
			expect(fetcher).toHaveBeenCalledOnce();
		},
	);
	it("freezes the original body and headers and submits only once after confirmation", async () => {
		const response = Response.json({ token: "issued" }, { status: 201 });
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(rejection())
			.mockResolvedValueOnce(response);
		unregister = registerCredentialConfirmation(async ({ summary, submit }) => {
			expect(summary).toContain("principal #42");
			return submit("acting-password");
		});
		const body = {
			expires_at: "2026-09-20T12:34:56.123456789",
			scope: { permissions: ["ReadObject"] },
		};
		const request = new Request(url, {
			method: "POST",
			headers: {
				"if-match": '"r:1"',
				"Idempotency-Key": "key",
				"X-Correlation-Id": "test-correlation",
			},
			body: JSON.stringify(body),
		});
		expect(await fetchWithCredentialApproval(fetcher, url, request)).toBe(
			response,
		);
		expect(request.bodyUsed).toBe(false);
		const [path, init] = fetcher.mock.calls[1];
		expect(path).toBe("/_hubuum-bff/credential-mutations");
		expect(JSON.parse(init.body)).toEqual({
			password: "acting-password",
			path: "/api/v1/iam/principals/42/tokens",
			method: "POST",
			body,
			ifMatch: '"r:1"',
			idempotencyKey: "key",
		});
		expect(init.headers.get("X-Correlation-Id")).toBe("test-correlation");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("never repeats a cancelled operation", async () => {
		const fetcher = vi.fn().mockResolvedValue(rejection());
		unregister = registerCredentialConfirmation(async () => null);
		const response = await fetchWithCredentialApproval(fetcher, url, url, {
			method: "POST",
			body: "{}",
		});
		expect(response.status).toBe(409);
		expect(fetcher).toHaveBeenCalledOnce();
	});
	it("does not prompt for an aborted mutation", async () => {
		const controller = new AbortController();
		const fetcher = vi.fn().mockImplementation(async () => {
			controller.abort();
			return rejection();
		});
		const handler = vi.fn();
		unregister = registerCredentialConfirmation(handler);
		await fetchWithCredentialApproval(fetcher, url, url, {
			method: "POST",
			body: "{}",
			signal: controller.signal,
		});
		expect(handler).not.toHaveBeenCalled();
	});
	it("does not interpret profile edits, reads, or revocations as approval operations", () => {
		expect(
			credentialOperation("PATCH", "/api/v1/iam/users/42", {
				proper_name: "Name",
			}),
		).toBeNull();
		expect(
			credentialOperation("GET", "/api/v1/iam/principals/42/tokens", {}),
		).toBeNull();
		expect(
			credentialOperation(
				"POST",
				"/api/v1/iam/principals/42/tokens/1/revoke",
				{},
			),
		).toBeNull();
	});
	it("keeps credential and restore secrets out of confirmation summaries", () => {
		expect(
			credentialOperationSummary({
				kind: "create_user",
				user: { name: "new", password: "new-secret" },
			}),
		).not.toContain("new-secret");
		expect(
			credentialOperationSummary({
				kind: "confirm_restore",
				restore_id: 1,
				confirmation: {
					restore_capability: "secret-capability",
					sha256: "digest",
				},
			}),
		).not.toContain("secret-capability");
	});
});
