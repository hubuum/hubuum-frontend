import { describe, expect, it } from "vitest";

import { buildDocumentTitle, getRouteTitle } from "@/lib/page-title";

describe("page titles", () => {
	it.each([
		["/app", "Home"],
		["/account", "Profile"],
		["/account/appearance", "Appearance"],
		["/relations/objects", "Object relations"],
		["/admin/configuration", "Configuration"],
		["/exports/templates/new", "New export template"],
	])("maps %s to %s", (pathname, expected) => {
		expect(getRouteTitle(pathname)).toBe(expected);
	});

	it.each([
		["/tasks/42", "Task #42"],
		["/admin/users/17", "User #17"],
		["/account/service-accounts/9", "Service account #9"],
		["/exports/templates/3", "Export template #3"],
	])("uses a useful fallback for %s", (pathname, expected) => {
		expect(getRouteTitle(pathname)).toBe(expected);
	});

	it("formats contextual browser titles", () => {
		expect(buildDocumentTitle("Hosts / abacus-as.uio.no")).toBe(
			"Hosts / abacus-as.uio.no · Hubuum",
		);
		expect(buildDocumentTitle("  ")).toBe("Hubuum");
	});
});
