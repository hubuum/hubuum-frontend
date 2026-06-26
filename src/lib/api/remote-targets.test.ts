import { describe, expect, it } from "vitest";
import type { RemoteTarget } from "@/lib/api/generated/models";
import {
	filterInvokableTargets,
	parseJsonObjectInput,
} from "@/lib/api/remote-targets";

function makeTarget(overrides: Partial<RemoteTarget>): RemoteTarget {
	return {
		allowed_subject_types: ["object"],
		auth_config: { type: "none" },
		created_at: "2026-06-25T10:00:00.000Z",
		description: "Target",
		enabled: true,
		headers_template: {},
		id: 1,
		method: "post",
		name: "target",
		namespace_id: 10,
		timeout_ms: 5000,
		updated_at: "2026-06-25T10:00:00.000Z",
		url_template: "https://example.com/{{ object.id }}",
		...overrides,
	};
}

describe("parseJsonObjectInput", () => {
	it("returns an empty object for blank input", () => {
		expect(parseJsonObjectInput("  ", "Parameters")).toEqual({});
	});

	it("parses valid JSON objects", () => {
		expect(parseJsonObjectInput('{"priority":"high"}', "Parameters")).toEqual({
			priority: "high",
		});
	});

	it("rejects invalid JSON", () => {
		expect(() => parseJsonObjectInput("{", "Parameters")).toThrow(
			"Parameters must be valid JSON.",
		);
	});

	it("rejects non-object JSON", () => {
		expect(() => parseJsonObjectInput("[]", "Parameters")).toThrow(
			"Parameters must be a JSON object.",
		);
	});
});

describe("filterInvokableTargets", () => {
	it("keeps enabled targets matching namespace and subject type", () => {
		const targets = [
			makeTarget({ id: 1 }),
			makeTarget({ id: 2, namespace_id: 11 }),
			makeTarget({ id: 3, allowed_subject_types: ["class"] }),
			makeTarget({ id: 4, enabled: false }),
			makeTarget({ id: 5, allowed_subject_types: ["namespace", "object"] }),
		];

		expect(filterInvokableTargets(targets, 10, "object").map((t) => t.id)).toEqual([]);
	});

	it("requires matching class scope for object targets", () => {
		const targets = [
			makeTarget({ id: 1, class_id: 20 }),
			makeTarget({ id: 2, class_id: 21 }),
			makeTarget({ id: 3, class_id: null }),
			makeTarget({ id: 4, allowed_subject_types: ["class"], class_id: null }),
		];

		expect(filterInvokableTargets(targets, 10, "object", 20).map((t) => t.id)).toEqual([
			1,
		]);
	});
});
