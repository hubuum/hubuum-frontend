import { describe, expect, it } from "vitest";

import {
	auditEntityCandidateMatches,
	type AuditEntityCandidate,
	isAuditEntityDirectoryKind,
	resolveAuditEntityCandidate,
} from "@/lib/audit-entity-options";

const collection: AuditEntityCandidate = {
	details: ["Production assets"],
	id: 7,
	inputValue: "servers",
	kind: "collection",
	name: "servers",
};

describe("audit entity options", () => {
	it("recognizes entity types with searchable directories", () => {
		expect(isAuditEntityDirectoryKind("collection")).toBe(true);
		expect(isAuditEntityDirectoryKind("object")).toBe(true);
		expect(isAuditEntityDirectoryKind("remote_target")).toBe(true);
		expect(isAuditEntityDirectoryKind("template")).toBe(true);
		expect(isAuditEntityDirectoryKind("task")).toBe(false);
	});

	it("matches names, IDs, and details", () => {
		expect(auditEntityCandidateMatches(collection, "servers")).toBe(true);
		expect(auditEntityCandidateMatches(collection, "7")).toBe(true);
		expect(auditEntityCandidateMatches(collection, "production")).toBe(true);
	});

	it("resolves only a unique exact entity", () => {
		expect(resolveAuditEntityCandidate("servers", [collection])).toBe(
			collection,
		);
		expect(resolveAuditEntityCandidate("7", [collection])).toBe(collection);
		expect(
			resolveAuditEntityCandidate("servers", [
				collection,
				{ ...collection, id: 8 },
			]),
		).toBeNull();
	});
});
