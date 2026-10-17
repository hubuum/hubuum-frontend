import { describe, expect, it } from "vitest";
import {
	advancedSearchUrl,
	buildAdvancedSearch,
	buildFieldPredicate,
	dateInputValue,
	emptyCondition,
	emptySearchDraft,
	newSearchNode,
	restoreAdvancedSearch,
	type SearchCondition,
	type SearchNode,
} from "@/lib/advanced-search";

function condition(
	field: string,
	operator: string,
	...values: string[]
): SearchNode {
	return {
		id: crypto.randomUUID(),
		kind: "field",
		negate: false,
		condition: { ...emptyCondition(), field, operator, values },
	};
}
function query(filter: SearchNode) {
	return { ...emptySearchDraft(), filter };
}

describe("advanced search", () => {
	it("displays restored offset dates as the same instant in UTC", () => {
		expect(dateInputValue("2026-10-17T15:00:00+02:00")).toBe(
			"2026-10-17T13:00:00.000",
		);
		expect(dateInputValue("2026-10-17T13:00")).toBe("2026-10-17T13:00");
		expect(dateInputValue("invalid")).toBe("invalid");
	});
	it("round-trips hydration settings independently of the root request", () => {
		const draft = {
			...query(condition("name", "contains", "server")),
			hydration: { classId: "13", depth: 3, limit: 25 },
		};
		const restored = restoreAdvancedSearch(JSON.stringify(draft));
		expect(restored.hydration).toEqual(draft.hydration);
		expect(buildAdvancedSearch(restored)).toEqual(
			buildAdvancedSearch({ ...draft, hydration: null }),
		);
		expect(() => buildAdvancedSearch({ ...draft, target: "class" })).toThrow();
	});
	it("round-trips (collection foo OR collection bar) AND name contains server", () => {
		const draft = query({
			...newSearchNode("group"),
			kind: "group",
			mode: "and",
			children: [
				{
					...newSearchNode("group"),
					kind: "group",
					mode: "or",
					children: [
						condition("collection_id", "equals", "42"),
						condition("collection_id", "equals", "73"),
					],
				},
				condition("name", "contains", "server"),
			],
		});
		const expected = {
			op: "and",
			args: [
				{
					op: "or",
					args: [42, 73].map((value) => ({
						op: "field",
						predicate: { field: "collection_id", operator: "equals", value },
					})),
				},
				{
					op: "field",
					predicate: { field: "name", operator: "contains", value: "server" },
				},
			],
		};
		expect(buildAdvancedSearch(draft).filter).toEqual(expected);
		const saved = new URL(
			advancedSearchUrl(draft),
			"http://localhost",
		).searchParams.get("query");
		expect(
			buildAdvancedSearch(restoreAdvancedSearch(saved ?? "")).filter,
		).toEqual(expected);
	});
	it("serializes collection alternatives as numeric IDs", () => {
		expect(
			buildAdvancedSearch(query(condition("collection_id", "in", "42", "73")))
				.filter,
		).toEqual({
			op: "field",
			predicate: { field: "collection_id", operator: "in", value: [42, 73] },
		});
	});
	it("keeps whole-group NOT and normalizes singleton groups", () => {
		const child = condition("name", "equals", "server");
		const draft = query({
			...newSearchNode("group"),
			kind: "group",
			mode: "or",
			negate: true,
			children: [child],
		});
		expect(
			buildAdvancedSearch(restoreAdvancedSearch(JSON.stringify(draft))).filter,
		).toEqual({
			op: "not",
			arg: {
				op: "field",
				predicate: { field: "name", operator: "equals", value: "server" },
			},
		});
	});
	it("uses the exact ID-backed object class selector", () => {
		expect(
			buildAdvancedSearch({
				...query(condition("id", "equals", "1")),
				classId: "12",
			}).target,
		).toEqual({ kind: "object", class: { id: 12 } });
	});
	it("preserves related existential class, depth, AND filters and whole-predicate NOT", () => {
		const draft = query({
			id: "related",
			kind: "related",
			negate: true,
			classId: "12",
			depth: "10",
			filters: [
				{
					...emptyCondition(),
					field: "collection_id",
					operator: "equals",
					values: ["42"],
				},
			],
		});
		expect(
			buildAdvancedSearch(restoreAdvancedSearch(JSON.stringify(draft))).filter,
		).toEqual({
			op: "not",
			arg: {
				op: "related",
				predicate: {
					class: { id: 12 },
					depth: 10,
					filters: [{ field: "collection_id", operator: "equals", value: 42 }],
				},
			},
		});
	});
	it.each(["0", "-1", "foo", "1.2", "2147483648", "001", " 42"])(
		"rejects invalid resource ID %s",
		(id) => {
			expect(() =>
				buildAdvancedSearch(query(condition("collection_id", "equals", id))),
			).toThrow("positive 32-bit ID");
		},
	);
	it.each(["collection", "class"] as const)(
		"retains and flags related filters when changing to %s",
		(target) => {
			const draft = {
				...query({
					id: "related",
					kind: "related",
					negate: false,
					classId: "12",
					depth: "1",
					filters: [],
				}),
				target,
			};
			expect(restoreAdvancedSearch(JSON.stringify(draft))).toEqual(draft);
			expect(() => buildAdvancedSearch(draft)).toThrow(
				"Related-object conditions require",
			);
		},
	);
	it("flags incompatible fields and sorts instead of dropping them", () => {
		const draft = {
			...query(condition("collection_id", "equals", "42")),
			target: "collection" as const,
		};
		expect(() => buildAdvancedSearch(draft)).toThrow("incompatible");
		expect(() =>
			buildAdvancedSearch({
				...query(condition("name", "equals", "x")),
				sort: [{ field: "json_data", direction: "asc" }],
			}),
		).toThrow("Sort field");
	});
	it("rejects empty nested groups instead of broadening the query", () => {
		expect(() =>
			buildAdvancedSearch(
				query({
					...newSearchNode("group"),
					kind: "group",
					mode: "and",
					children: [],
				}),
			),
		).toThrow("Empty groups");
	});
	it.each([
		["name", "gt", ["a"], "not valid"],
		["revision", "equals", ["one"], "whole number"],
		["revision", "between", ["4"], "two range bounds"],
		["revision", "between", ["4", "2"], "lower range"],
		["name", "equals", [""], "Enter a value"],
		["name", "in", ["a,b"], "commas"],
		["created_at", "equals", ["yesterday"], "valid date"],
	] as const)(
		"rejects invalid %s/%s values",
		(field, operator, values, message) => {
			expect(() =>
				buildAdvancedSearch(query(condition(field, operator, ...values))),
			).toThrow(message);
		},
	);
	it("supports no-value operators, booleans, numeric JSON values and UTC timestamps", () => {
		const build = (
			changes: Partial<SearchCondition>,
			target: "class" | "object" = "object",
		) => buildFieldPredicate({ ...emptyCondition(), ...changes }, target);
		expect(build({ operator: "is_null", values: [] })).toEqual({
			field: "name",
			operator: "is_null",
		});
		expect(
			build(
				{ field: "validate_schema", operator: "equals", values: ["false"] },
				"class",
			).value,
		).toBe(false);
		expect(
			build({
				field: "json_data",
				path: "hardware.cpu.count",
				operator: "gte",
				valueType: "number",
				values: ["8"],
			}),
		).toEqual({
			field: "json_data",
			path: "hardware.cpu.count",
			operator: "gte",
			value: 8,
		});
		expect(
			build({
				field: "created_at",
				operator: "gte",
				values: ["2026-01-01T12:30"],
			}).value,
		).toBe("2026-01-01T12:30:00Z");
	});
	it.each(["", "hardware..cpu", "a,b", "a[0]", "a.b-c"])(
		"rejects invalid JSON path %s",
		(path) => {
			expect(() =>
				buildFieldPredicate(
					{ ...emptyCondition(), field: "json_data", path, values: ["x"] },
					"object",
				),
			).toThrow("JSON path");
		},
	);
	it("enforces field, related, nesting and value bounds", () => {
		expect(() =>
			buildAdvancedSearch(
				query({
					...newSearchNode("group"),
					kind: "group",
					mode: "and",
					children: Array.from({ length: 33 }, () =>
						condition("name", "equals", "x"),
					),
				}),
			),
		).toThrow("32 field");
		let nested = condition("name", "equals", "x");
		for (let i = 0; i < 9; i++)
			nested = {
				...newSearchNode("group"),
				kind: "group",
				mode: "or",
				children: [nested],
			};
		expect(() => buildAdvancedSearch(query(nested))).toThrow("nesting");
		expect(() =>
			buildAdvancedSearch(
				query({
					...newSearchNode("related"),
					kind: "related",
					classId: "12",
					depth: "11",
					filters: [],
				}),
			),
		).toThrow("1 to 10");
	});
	it("rejects unsupported saved versions, extra fields and stale cursors", () => {
		const draft = query(condition("name", "equals", "server"));
		for (const extra of [
			{ version: 2 },
			{ cursor: "old" },
			{ include: "unknown" },
		])
			expect(() =>
				restoreAdvancedSearch(JSON.stringify({ ...draft, ...extra })),
			).toThrow();
		expect(() => restoreAdvancedSearch("not json")).toThrow();
	});
});
