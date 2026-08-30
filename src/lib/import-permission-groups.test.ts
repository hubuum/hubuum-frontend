import { describe, expect, it } from "vitest";
import type { ImportRequest } from "@/lib/api/generated/models";
import {
	findMissingImportPermissionGroups,
	getImportPermissionGroups,
} from "@/lib/import-permission-groups";
import type { ConsoleGroup } from "@/lib/identity-scopes";

describe("import permission group validation", () => {
	it("accepts a scoped file group outside an initial 250-group page", () => {
		const payload = {
			version: 1,
			graph: {
				collection_permissions: [
					{
						collection_key: { name: "Infrastructure" },
						group_key: {
							groupname: "late-group",
							identity_scope: "directory",
						},
						permissions: ["read"],
					},
				],
			},
		} as unknown as ImportRequest;
		const groups = Array.from({ length: 251 }, (_, index) => ({
			groupname: index === 250 ? "late-group" : `group-${index + 1}`,
			id: index + 1,
			identity_scope: index === 250 ? "directory" : "local",
		})) as ConsoleGroup[];

		const references = getImportPermissionGroups(payload);

		expect(references).toEqual([
			{
				key: "directory\u0000late-group",
				label: "directory/late-group",
			},
		]);
		expect(findMissingImportPermissionGroups(references, groups)).toEqual([]);
	});
});
