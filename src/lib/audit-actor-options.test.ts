import { describe, expect, it } from "vitest";

import {
	auditActorCandidateInputValue,
	auditActorCandidateMatches,
	formatAuditActorCandidate,
	getAuditActorSearchTerm,
	type AuditActorCandidate,
	resolveAuditActorCandidate,
} from "@/lib/audit-actor-options";

const user: AuditActorCandidate = {
	details: ["Alice Example", "alice@example.com"],
	id: 7,
	identityScope: "local",
	kind: "user",
	name: "alice",
};
const serviceAccount: AuditActorCandidate = {
	details: ["Collects Ansible facts"],
	id: 19,
	identityScope: "automation",
	kind: "service_account",
	name: "ansible-facts",
};

describe("audit actor options", () => {
	it("formats scoped identity names, IDs, and useful details", () => {
		expect(auditActorCandidateInputValue(user)).toBe("alice");
		expect(auditActorCandidateInputValue(serviceAccount)).toBe(
			"automation/ansible-facts",
		);
		expect(formatAuditActorCandidate(user)).toBe(
			"alice (#7) · Alice Example · alice@example.com",
		);
		expect(formatAuditActorCandidate(serviceAccount)).toBe(
			"automation/ansible-facts (#19) · Collects Ansible facts",
		);
	});

	it("extracts the principal name for server-side filtering", () => {
		expect(getAuditActorSearchTerm("alice")).toBe("alice");
		expect(getAuditActorSearchTerm("automation/ansible-facts")).toBe(
			"ansible-facts",
		);
		expect(getAuditActorSearchTerm(formatAuditActorCandidate(user))).toBe(
			"alice",
		);
	});

	it("matches names, scoped names, IDs, and details", () => {
		expect(auditActorCandidateMatches(user, "alice")).toBe(true);
		expect(auditActorCandidateMatches(user, "example.com")).toBe(true);
		expect(auditActorCandidateMatches(serviceAccount, "automation/ansible")).toBe(
			true,
		);
		expect(auditActorCandidateMatches(serviceAccount, "19")).toBe(true);
	});

	it("resolves a unique exact identity and leaves partial searches unresolved", () => {
		const candidates = [user, serviceAccount];
		expect(resolveAuditActorCandidate("alice", candidates)).toBe(user);
		expect(resolveAuditActorCandidate("alice@example.com", candidates)).toBe(
			user,
		);
		expect(resolveAuditActorCandidate("19", candidates)).toBe(serviceAccount);
		expect(resolveAuditActorCandidate("ansible", candidates)).toBeNull();
	});

	it("does not guess when an exact detail matches more than one actor", () => {
		const duplicate = { ...user, id: 8 };
		expect(resolveAuditActorCandidate("alice", [user, duplicate])).toBeNull();
	});
});
