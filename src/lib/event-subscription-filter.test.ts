import { describe, expect, it } from "vitest";
import { preserveTaskKindFilter } from "@/lib/event-subscription-filter";

describe("preserveTaskKindFilter", () => {
	it("retains task kinds without restoring cleared editable filters", () => {
		expect(
			preserveTaskKindFilter(
				{ entity_names: ["updated"] },
				{ task_kinds: ["import", "export"], actor_user_ids: [42] },
			),
		).toEqual({ entity_names: ["updated"], task_kinds: ["import", "export"] });
	});

	it("keeps task kinds when all editable filters are removed", () => {
		expect(
			preserveTaskKindFilter(undefined, { task_kinds: ["import"] }),
		).toEqual({
			task_kinds: ["import"],
		});
	});

	it("does not add filters to new or legacy subscriptions", () => {
		expect(preserveTaskKindFilter(undefined, undefined)).toBeUndefined();
		expect(
			preserveTaskKindFilter(undefined, { task_kinds: [] }),
		).toBeUndefined();
		expect(preserveTaskKindFilter({ entity_ids: [1] }, {})).toEqual({
			entity_ids: [1],
		});
	});
});
