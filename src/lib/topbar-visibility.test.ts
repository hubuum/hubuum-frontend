import { describe, expect, it } from "vitest";
import { usesCompactTopbar } from "@/lib/topbar-visibility";

describe("topbar visibility", () => {
	it.each([
		"/app",
		"/account",
		"/account/appearance",
		"/imports",
		"/exports",
		"/exports/templates/2",
		"/tasks",
		"/tasks/42",
		"/admin/configuration",
		"/admin/backups",
		"/audit",
		"/statistics",
		"/objects/10/31",
		"/classes/10",
		"/collections/20",
	])("removes the redundant heading from %s", (pathname) => {
		expect(usesCompactTopbar(pathname)).toBe(true);
	});

	it.each(["/collections", "/classes", "/objects", "/admin/users"])(
		"keeps the contextual heading on %s",
		(pathname) => {
			expect(usesCompactTopbar(pathname)).toBe(false);
		},
	);
});
