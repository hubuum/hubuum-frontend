import { describe, expect, it } from "vitest";
import type { HubuumClassRelation } from "@/lib/api/generated/models";
import { filterClassRelations } from "@/lib/class-relation-filters";

const relations: HubuumClassRelation[] = [
	{
		id: 1,
		from_hubuum_class_id: 1,
		to_hubuum_class_id: 2,
		created_at: "2026-07-14T00:00:00Z",
		updated_at: "2026-07-14T00:00:00Z",
	},
	{
		id: 2,
		from_hubuum_class_id: 2,
		to_hubuum_class_id: 1,
		created_at: "2026-07-14T00:00:00Z",
		updated_at: "2026-07-14T00:00:00Z",
	},
	{
		id: 3,
		from_hubuum_class_id: 1,
		to_hubuum_class_id: 3,
		created_at: "2026-07-14T00:00:00Z",
		updated_at: "2026-07-14T00:00:00Z",
	},
];

describe("filterClassRelations", () => {
	it("returns the full inventory without filters", () => {
		expect(
			filterClassRelations(relations, {
				fromClassId: null,
				toClassId: null,
			}),
		).toEqual(relations);
	});

	it("filters independently by either endpoint", () => {
		expect(
			filterClassRelations(relations, {
				fromClassId: 1,
				toClassId: null,
			}).map((relation) => relation.id),
		).toEqual([1, 3]);

		expect(
			filterClassRelations(relations, {
				fromClassId: null,
				toClassId: 1,
			}).map((relation) => relation.id),
		).toEqual([2]);
	});

	it("combines from and to filters", () => {
		expect(
			filterClassRelations(relations, {
				fromClassId: 1,
				toClassId: 3,
			}).map((relation) => relation.id),
		).toEqual([3]);
	});
});
