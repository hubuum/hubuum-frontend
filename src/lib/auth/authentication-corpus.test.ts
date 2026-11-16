/** Shared vectors exercise frontend wire/error/redaction ownership. Database,
 * IdP, authorization and membership effects remain server integration checks. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
	securityCandidateInput,
	securityCandidateError,
} from "@/lib/security-candidate";
import {
	publicCandidateSchema,
	publicPreviewSchema,
} from "@/lib/api/security-candidates";
import {
	parseCandidatePreview,
	parseCandidateReport,
	publicCandidateReport,
} from "./candidate-verification";
import {
	authenticationResponseError,
	parseAuthenticationMethods,
	parseInteractionBegun,
	readAuthenticationResponse,
} from "./interactions-protocol";

vi.mock("@/lib/api/backend", () => ({ backendFetchRaw: vi.fn() }));
vi.mock("@/lib/env", () => ({ getServerEnv: vi.fn() }));
vi.mock("@/lib/valkey", () => ({ getValkeyClient: vi.fn() }));
type Case = {
	id: string;
	operation_id: string;
	request: Record<string, unknown>;
	response: {
		status: number;
		body?: Record<string, unknown>;
		headers?: Record<string, string>;
	};
};
const raw = readFileSync(
	new URL(
		"../../../tests/fixtures/authentication/fixtures.json",
		import.meta.url,
	),
);
const corpus = JSON.parse(raw.toString()) as { clock: string; cases: Case[] };
const candidateId = "dddddddd-dddd-4ddd-addd-dddddddddddd";
function materialize(value: unknown): unknown {
	if (typeof value === "string") {
		if (value === "candidate-fixture") return candidateId;
		if (
			[
				"interaction-fixture",
				"bff-interaction-fixture",
				"verification-interaction-fixture",
			].includes(value)
		)
			return "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
		if (value === "FIXTURE-REDEMPTION-SECRET-NEVER-USE-IN-PRODUCTION")
			return `hai1.${"a".repeat(64)}`;
		if (value === "FIXTURE-VERIFICATION-RECEIPT-NEVER-USE-IN-PRODUCTION")
			return `hcv1.${"b".repeat(64)}`;
		return value;
	}
	if (Array.isArray(value)) return value.map(materialize);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, materialize(item)]),
		);
	return value;
}
describe("pinned shared authentication vectors: frontend-owned contract", () => {
	it("pins the complete unmodified 48-case corpus", () => {
		expect(createHash("sha256").update(raw).digest("hex")).toBe(
			"027eff028cb1c7252132f1f93225957f548ccb0dd839e2b7e5c291efb872c028",
		);
		expect(corpus.cases).toHaveLength(48);
		expect(new Set(corpus.cases.map((item) => item.id)).size).toBe(48);
	});
	it.each(corpus.cases)(
		"$id preserves bounded JSON and uses closed frontend errors",
		async (fixture) => {
			if (fixture.response.status === 204) {
				expect(fixture.response.body).toBeUndefined();
				return;
			}
			const body = materialize(fixture.response.body) as Record<
				string,
				unknown
			>;
			const response = Response.json(body, {
				status: fixture.response.status,
				headers: fixture.response.headers,
			});
			expect(await readAuthenticationResponse(response)).toEqual(body);
			if (fixture.response.status >= 400) {
				const error = authenticationResponseError(response, body);
				expect(error.message).not.toContain(String(body.message));
				expect(error.message).not.toMatch(/hai1\.|hca1\.|hcv1\./);
				if (fixture.operation_id === "activateSecurityCandidate")
					expect(securityCandidateError(fixture.response.status)).toMatch(
						/local|changed|rejected|confirm/,
					);
			}
		},
	);
	it.each(
		corpus.cases.filter((item) =>
			[
				"local_begin",
				"external_begin",
				"bff_begin",
				"candidate_verification_begin",
			].includes(item.id),
		),
	)("$id validates private interaction authority", (fixture) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(corpus.clock));
		try {
			expect(
				parseInteractionBegun(
					materialize(fixture.response.body),
					"https://hubuum.example.invalid",
				).interaction_version,
			).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});
	it("discovery requires the browser-availability field introduced after the historical vector", () => {
		const body = corpus.cases.find((item) => item.id === "discovery")?.response
			.body;
		expect(() => parseAuthenticationMethods(body)).toThrow();
		const methods = ((body?.methods ?? []) as Record<string, unknown>[]).map(
			(method) => ({ ...method, browser_available: true }),
		);
		expect(
			parseAuthenticationMethods({ ...body, methods }).methods,
		).toHaveLength(methods.length);
	});
	it("connectivity alone remains unverified and cannot be presented as an activated provider", () => {
		const fixture = corpus.cases.find(
			(item) => item.id === "candidate_connectivity_only",
		);
		expect(securityCandidateInput.parse(fixture?.request).group).toBe(
			"authentication",
		);
		const publicReport = publicCandidateReport(
			parseCandidateReport(materialize(fixture?.response.body)),
		);
		expect(publicCandidateSchema.parse(publicReport).state).toBe("unverified");
		expect(publicReport).not.toHaveProperty("verification_receipt");
	});
	it("browser preview removes the receipt and preserves admission and non-provisioning facts", () => {
		const fixture = corpus.cases.find(
			(item) => item.id === "candidate_browser_verified",
		);
		const { candidate, verification } = parseCandidatePreview(
			materialize(fixture?.response.body),
			candidateId,
			"00000000-0000-4000-8000-000000000002",
		);
		const visible = publicPreviewSchema.parse({
			candidate: publicCandidateReport(candidate),
			verification,
		});
		expect(visible.verification).toMatchObject({
			admitted: false,
			provisioned: false,
			issued_session: false,
		});
		expect(JSON.stringify(visible)).not.toContain("hcv1.");
	});
});
