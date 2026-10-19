import { describe, expect, it } from "vitest";
import type { QueryUsagePatternSchema } from "@/lib/api/generated/models";
import {
	hasQueryUsageDeclaration,
	queryUsageOperations,
	queryUsagePatternError,
} from "@/lib/query-usage";

const pattern: QueryUsagePatternSchema = {
	path: "hardware,serial_number",
	value_type: "string",
	operations: ["equals"],
};

describe("query usage patterns", () => {
	it("allows equality for text and booleans and ranges for numbers", () => {
		expect(queryUsagePatternError(pattern)).toBeNull();
		expect(
			queryUsagePatternError({ ...pattern, value_type: "boolean" }),
		).toBeNull();
		expect(
			queryUsagePatternError({
				...pattern,
				value_type: "numeric",
				operations: queryUsageOperations("numeric"),
			}),
		).toBeNull();
		expect(
			queryUsagePatternError({ ...pattern, operations: ["gt"] }),
		).not.toBeNull();
		expect(
			queryUsagePatternError({ ...pattern, operations: [] }),
		).not.toBeNull();
	});
	it("checks path bytes and segments without treating a dot as a separator", () => {
		for (const path of [
			"",
			" ",
			"a,,b",
			"a,",
			Array(33).fill("a").join(","),
			"é".repeat(257),
		])
			expect(queryUsagePatternError({ ...pattern, path })).not.toBeNull();
		for (const path of ["a.b", "é".repeat(256), Array(32).fill("a").join(",")])
			expect(queryUsagePatternError({ ...pattern, path })).toBeNull();
	});
	it("recognizes duplicate path/type intent even with different operations", () => {
		const numeric = { ...pattern, value_type: "numeric" as const };
		expect(
			hasQueryUsageDeclaration([{ pattern: numeric }], {
				...numeric,
				operations: ["between"],
			}),
		).toBe(true);
		expect(hasQueryUsageDeclaration([{ pattern }], numeric)).toBe(false);
		expect(
			hasQueryUsageDeclaration([{ pattern }], { ...pattern, path: "other" }),
		).toBe(false);
	});
});
