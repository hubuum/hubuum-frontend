import { describe, expect, it } from "vitest";

import { Permissions } from "@/lib/api/generated/models";
import { toTokenMintInitialValues } from "@/lib/token-clone";

describe("toTokenMintInitialValues", () => {
	it("copies exact permission and resource boundaries without the old expiry", () => {
		expect(
			toTokenMintInitialValues(
				{
					active: true,
					expired: false,
					id: 42,
					principal_id: 7,
					name: "deployment",
					description: "Production deployer",
					issued: "2026-08-01T09:00:00Z",
					expires_at: "2026-08-05T09:00:00Z",
					revision: 1,
					scope: {
						permissions: [Permissions.ReadObject, Permissions.UpdateObject],
						resources: [
							{ kind: "collection", id: 3 },
							{ kind: "object", id: 19 },
						],
					},
				},
				{
					"collection:3": "Production",
					"object:19": "api-01",
				},
			),
		).toEqual({
			description: "Production deployer",
			name: "deployment (clone)",
			permissions: [Permissions.ReadObject, Permissions.UpdateObject],
			resources: [
				{ kind: "collection", id: 3, label: "Production" },
				{ kind: "object", id: 19, label: "api-01" },
			],
			sourceTokenId: 42,
		});
	});

	it("preserves unrestricted dimensions for an unscoped token", () => {
		expect(
			toTokenMintInitialValues({
				active: true,
				expired: false,
				id: 43,
				principal_id: 7,
				issued: "2026-08-01T09:00:00Z",
				revision: 1,
				scope: null,
			}),
		).toEqual({
			description: "",
			name: "",
			permissions: null,
			resources: null,
			sourceTokenId: 43,
		});
	});

	it("keeps resource IDs usable when their names cannot be resolved", () => {
		expect(
			toTokenMintInitialValues({
				active: true,
				expired: false,
				id: 44,
				principal_id: 7,
				issued: "2026-08-01T09:00:00Z",
				revision: 1,
				scope: {
					permissions: null,
					resources: [{ kind: "class", id: 404 }],
				},
			}).resources,
		).toEqual([{ kind: "class", id: 404, label: "Class #404" }]);
	});
});
