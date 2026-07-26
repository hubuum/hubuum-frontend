import { describe, expect, it } from "vitest";

import {
	formatGroupMembershipCandidateOption,
	type GroupMembershipCandidate,
	groupMembershipCandidateMatches,
	resolveGroupMembershipCandidate,
} from "@/lib/group-membership-candidates";

const human: GroupMembershipCandidate = {
	detail: "alice@example.com",
	id: 7,
	identityScope: "local",
	kind: "human",
	name: "alice",
};
const serviceAccount: GroupMembershipCandidate = {
	detail: "Collects Ansible facts",
	id: 19,
	identityScope: "local",
	kind: "service_account",
	name: "ansible-facts",
};

describe("group-membership-candidates", () => {
	it("labels principal kind in autocomplete options", () => {
		expect(formatGroupMembershipCandidateOption(human)).toBe(
			"alice (#7) · Human · alice@example.com",
		);
		expect(formatGroupMembershipCandidateOption(serviceAccount)).toBe(
			"ansible-facts (#19) · Service account · Collects Ansible facts",
		);
	});

	it("matches service accounts by name, description, id, and kind", () => {
		expect(groupMembershipCandidateMatches(serviceAccount, "ansible")).toBe(
			true,
		);
		expect(groupMembershipCandidateMatches(serviceAccount, "facts")).toBe(true);
		expect(groupMembershipCandidateMatches(serviceAccount, "19")).toBe(true);
		expect(
			groupMembershipCandidateMatches(serviceAccount, "service account"),
		).toBe(true);
	});

	it("resolves exact options and principal ids", () => {
		const candidates = [human, serviceAccount];
		expect(
			resolveGroupMembershipCandidate(
				formatGroupMembershipCandidateOption(serviceAccount),
				candidates,
			),
		).toBe(serviceAccount);
		expect(resolveGroupMembershipCandidate("7", candidates)).toBe(human);
	});

	it("uses unprefixed names for local identities and scoped provider names", () => {
		const duplicate = {
			...serviceAccount,
			id: 20,
			identityScope: "provider",
			name: "alice",
		};
		expect(resolveGroupMembershipCandidate("alice", [human, duplicate])).toBe(
			human,
		);
		expect(
			resolveGroupMembershipCandidate("provider/alice", [human, duplicate]),
		).toBe(duplicate);
	});
});
