import { describe, expect, it } from "vitest";

import type { ImportRequest } from "@/lib/api/generated/models";
import { buildImportSubmissionPayload } from "@/lib/import-payload";

describe("scoped import permission groups", () => {
	it("preserves the selected identity scope in delegate group keys", () => {
		const payload: ImportRequest = {
			version: 1,
			graph: {
				collections: [
					{
						description: "Infrastructure",
						name: "infra",
						ref: "collection:infra",
					},
				],
			},
		};

		const result = buildImportSubmissionPayload(payload, {
			atomicity: "strict",
			collisionPolicy: "abort",
			collectionMode: "file",
			delegateGroupIdentityScope: "directory",
			delegateGroupName: "ops",
			dryRun: false,
			permissionPolicy: "abort",
		});

		expect(result.graph.collection_permissions).toHaveLength(1);
		expect(result.graph.collection_permissions?.[0].group_key).toEqual({
			groupname: "ops",
			identity_scope: "directory",
		});
	});
});
