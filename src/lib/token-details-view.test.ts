import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TokenDetailsModal } from "@/components/token-details-modal";
import { Permissions } from "@/lib/api/generated/models";

describe("TokenDetailsModal", () => {
	it("renders every permission and resource boundary from token metadata", () => {
		const markup = renderToStaticMarkup(
			createElement(TokenDetailsModal, {
				token: {
					id: 14,
					principal_id: 3,
					name: "automation",
					description: "Deployment token",
					issued: "2026-07-25T10:00:00Z",
					scope: {
						permissions: [
							Permissions.ReadCollection,
							Permissions.ReadClass,
						],
						resources: [
							{ kind: "collection", id: 17 },
							{ kind: "class", id: 23 },
							{ kind: "object", id: 99 },
						],
					},
				},
				onClose: () => undefined,
				resourceNames: {
					"collection:17": "Infrastructure",
					"class:23": "Server",
					"object:99": "api-01",
				},
			}),
		);

		expect(markup).toContain("Token #14");
		expect(markup).toContain("ReadCollection");
		expect(markup).toContain("ReadClass");
		expect(markup).toContain("Collections");
		expect(markup).toContain("Infrastructure");
		expect(markup).toContain("#17");
		expect(markup).toContain("Classes");
		expect(markup).toContain("Server");
		expect(markup).toContain("#23");
		expect(markup).toContain("Objects");
		expect(markup).toContain("api-01");
		expect(markup).toContain("#99");
		expect(markup).toContain("View complete token metadata");
	});

	it("retains an exact ID when a resource name cannot be resolved", () => {
		const markup = renderToStaticMarkup(
			createElement(TokenDetailsModal, {
				token: {
					id: 16,
					principal_id: 3,
					issued: "2026-07-25T10:00:00Z",
					scope: {
						resources: [{ kind: "class", id: 404 }],
					},
				},
				onClose: () => undefined,
				unresolvedResourceNames: 1,
			}),
		);

		expect(markup).toContain("Name unavailable");
		expect(markup).toContain("#404");
		expect(markup).toContain("Could not resolve 1 resource name");
	});

	it("explains the authority of an unscoped token", () => {
		const markup = renderToStaticMarkup(
			createElement(TokenDetailsModal, {
				token: {
					id: 15,
					principal_id: 3,
					issued: "2026-07-25T10:00:00Z",
					scope: null,
				},
				onClose: () => undefined,
			}),
		);

		expect(markup).toContain("Unscoped");
		expect(markup).toContain(
			"no token-specific permission or resource boundary",
		);
	});
});
