import { describe, expect, it } from "vitest";

import type { ImportRequest } from "@/lib/api/generated/models";
import { buildImportSubmissionPayload } from "@/lib/import-payload";

describe("revision-aware imports", () => {
	const activation = {
		revision: 4,
		expected_active_revision: 2,
		policy: "reject_incompatible" as const,
		impact_task_id: 99,
	};
	const payload: ImportRequest = {
		version: 1,
		graph: {
			classes: [
				{
					name: "Devices",
					description: "Devices",
					collection_key: { name: "Infrastructure" },
					json_schema: { type: "object" },
					validate_schema: true,
					schema_activation: activation,
				},
			],
		},
	};
	it("preserves the exact staged revision and proof during dry runs", () => {
		const result = buildImportSubmissionPayload(payload, {
			atomicity: "strict",
			collisionPolicy: "overwrite",
			collectionMode: "file",
			dryRun: true,
			permissionPolicy: "abort",
		});
		expect(result.graph.classes?.[0].schema_activation).toEqual(activation);
		expect(result.dry_run).toBe(true);
	});
	it.each(["existing_override", "create_override"] as const)(
		"rejects retargeting a staged activation with %s",
		(collectionMode) => {
			expect(() =>
				buildImportSubmissionPayload(payload, {
					atomicity: "strict",
					collisionPolicy: "overwrite",
					collectionMode,
					collectionName: "Other",
					collectionDescription: "Other collection",
					dryRun: false,
					permissionPolicy: "abort",
				}),
			).toThrow("file destinations");
		},
	);
});

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
