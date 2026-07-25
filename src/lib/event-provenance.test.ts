import { describe, expect, it } from "vitest";

import {
	formatEventActor,
	formatEventInitiator,
	getProvenanceTaskId,
} from "@/lib/event-provenance";

describe("event provenance", () => {
	it("uses resolved v0.0.4 provenance names", () => {
		const record = {
			actor_kind: "worker",
			actor_user_id: null,
			provenance: {
				actor: {
					kind: "worker",
					principal: { name: null, principal_id: 9 },
				},
				initiator: { name: "alice", principal_id: 4 },
				task_id: 27,
			},
		};

		expect(formatEventActor(record)).toBe("worker #9");
		expect(formatEventInitiator(record)).toBe("alice (#4)");
		expect(getProvenanceTaskId(record)).toBe(27);
	});

	it("falls back to legacy actor and initiator fields", () => {
		const record = {
			actor_kind: "user",
			actor_user_id: 3,
			initiator_user_id: 3,
		};

		expect(formatEventActor(record)).toBe("user #3");
		expect(formatEventInitiator(record)).toBe("Principal #3");
		expect(getProvenanceTaskId(record)).toBeNull();
	});
});
