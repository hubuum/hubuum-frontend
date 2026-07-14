import { describe, expect, it } from "vitest";
import { getRelationsContextVisibility } from "@/lib/relations-context";

describe("getRelationsContextVisibility", () => {
	it("hides context selectors for the global direct relation inventory", () => {
		expect(getRelationsContextVisibility("classes", "direct")).toEqual({
			showClass: false,
			showObject: false,
		});
	});

	it("shows only class context for connected classes", () => {
		expect(getRelationsContextVisibility("classes", "connected")).toEqual({
			showClass: true,
			showObject: false,
		});
	});

	it("shows class and object context for object relations", () => {
		expect(getRelationsContextVisibility("objects", null)).toEqual({
			showClass: true,
			showObject: true,
		});
	});
});
