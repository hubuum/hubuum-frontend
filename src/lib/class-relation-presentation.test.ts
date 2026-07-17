import { describe, expect, it } from "vitest";

import type { HubuumClassRelation } from "@/lib/api/generated/models";
import { presentClassRelation } from "@/lib/class-relation-presentation";

const relation: HubuumClassRelation = {
	id: 7,
	from_hubuum_class_id: 1,
	to_hubuum_class_id: 2,
	forward_template_alias: "contains",
	reverse_template_alias: "belongs to",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

describe("presentClassRelation", () => {
	it("presents an outgoing relation using the forward alias", () => {
		expect(presentClassRelation(relation, 1)).toEqual({
			relatedClassId: 2,
			direction: "Outgoing",
			alias: "contains",
		});
	});

	it("presents an incoming relation using the reverse alias", () => {
		expect(presentClassRelation(relation, 2)).toEqual({
			relatedClassId: 1,
			direction: "Incoming",
			alias: "belongs to",
		});
	});
});
