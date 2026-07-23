import { describe, expect, it } from "vitest";

import { toNaiveDateTimePayload } from "@/lib/naive-datetime";

describe("toNaiveDateTimePayload", () => {
	it("adds seconds without changing the selected local time", () => {
		expect(toNaiveDateTimePayload("2027-10-01T23:33")).toBe(
			"2027-10-01T23:33:00",
		);
	});

	it("preserves valid seconds and fractional seconds", () => {
		expect(toNaiveDateTimePayload("2027-10-01T23:33:42")).toBe(
			"2027-10-01T23:33:42",
		);
		expect(toNaiveDateTimePayload("2027-10-01T23:33:42.125")).toBe(
			"2027-10-01T23:33:42.125",
		);
	});

	it("rejects timezone-bearing values and blanks", () => {
		expect(toNaiveDateTimePayload("2027-10-01T21:33:00.000Z")).toBeUndefined();
		expect(toNaiveDateTimePayload("")).toBeUndefined();
	});
});
