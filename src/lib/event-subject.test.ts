import { expect, it } from "vitest";
import { eventSubject } from "@/lib/event-subject";
const subject = {
	principal_id: 42,
	name: "Alice at login",
	kind: "human",
	identity_scope: "local",
	authentication_provider_kind: "local",
	is_admin: false,
};
it("reads the immutable subject, preserving false administrator status", () => {
	expect(eventSubject({ subject })).toEqual(subject);
});
it("rejects missing, malformed, or partial subject snapshots", () => {
	for (const metadata of [
		null,
		[],
		{},
		{ subject: null },
		{ subject: { ...subject, is_admin: "false" } },
		{ subject: { ...subject, principal_id: "42" } },
		{ subject: { ...subject, kind: "unknown" } },
	])
		expect(eventSubject(metadata)).toBeNull();
});
