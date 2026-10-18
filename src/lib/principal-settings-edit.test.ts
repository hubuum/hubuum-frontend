import { expect, it } from "vitest";
import { parseSettingsEdit } from "@/lib/principal-settings-edit";
it("accepts object roots and preserves nested null for replacement", () => {
	expect(parseSettingsEdit('{"theme":null}', "replace")).toEqual({
		theme: null,
	});
	for (const text of ["[]", "null", '"text"', "12"])
		expect(() => parseSettingsEdit(text, "merge")).toThrow();
});
it("validates JSON Patch operations without losing false or null values", () => {
	const operations = [
		{ op: "test", path: "/flag", value: false },
		{ op: "add", path: "/nested", value: null },
		{ op: "copy", from: "/old", path: "/new" },
		{ op: "remove", path: "/old" },
	];
	expect(parseSettingsEdit(JSON.stringify(operations), "patch")).toEqual(
		operations,
	);
	for (const op of [
		{ op: "add", path: "/x" },
		{ op: "copy", path: "/x" },
		{ op: "remove", path: "x" },
		{ op: "unknown", path: "" },
	])
		expect(() => parseSettingsEdit(JSON.stringify([op]), "patch")).toThrow();
});
