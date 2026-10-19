import { describe, expect, it } from "vitest";
import {
	mergeSubscriptionFilters,
	subscriptionSubjectIds,
} from "@/lib/event-subscription-filter";

describe("subscription filters", () => {
	it("preserves unknown server filters without reviving cleared fields", () => {
		const original = {
			task_kinds: ["import"] as const,
			actor_user_ids: [42],
			subject_is_admin: true,
			future_filter: { enabled: true },
		};
		expect(
			mergeSubscriptionFilters(
				{ subject_is_admin: false, task_kinds: ["backup"] },
				{ ...original, task_kinds: [...original.task_kinds] },
			),
		).toEqual({
			future_filter: { enabled: true },
			subject_is_admin: false,
			task_kinds: ["backup"],
		});
	});
	it("clears every editable filter explicitly", () => {
		expect(
			mergeSubscriptionFilters(undefined, {
				task_kinds: ["import"],
				subject_principal_ids: [4],
				subject_identity_scopes: ["local"],
				subject_is_admin: true,
			}),
		).toEqual({});
	});
	it("supports new subscriptions", () => {
		expect(mergeSubscriptionFilters(undefined, undefined)).toEqual({});
	});
	it("validates exact positive subject IDs without lossy parsing", () => {
		expect(subscriptionSubjectIds(" 4, 23, 4 ")).toEqual([4, 23]);
		expect(subscriptionSubjectIds(" ")).toBeUndefined();
		for (const value of ["1x", "0", "-1", "1.2", "1,", "9007199254740992"])
			expect(() => subscriptionSubjectIds(value)).toThrow();
	});
});
