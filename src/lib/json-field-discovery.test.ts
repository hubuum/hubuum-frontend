import { describe, expect, it } from "vitest";

import {
	discoverJsonFields,
	toTemplateDataExpression,
} from "@/lib/json-field-discovery";

describe("discoverJsonFields", () => {
	it("keeps schema fields authoritative and adds sampled fields", () => {
		const fields = discoverJsonFields(
			{
				type: "object",
				properties: {
					active: { type: "boolean" },
					owner: {
						type: "object",
						properties: { name: { type: "string" } },
					},
				},
			},
			[
				{ active: true, owner: { name: "Ada" }, score: 8 },
				{ active: false, owner: { name: "Grace" }, score: 13 },
			],
		);

		expect(fields).toEqual([
			expect.objectContaining({
				label: "active",
				source: "schema",
				types: ["boolean"],
				observedIn: 2,
			}),
			expect.objectContaining({
				label: "owner.name",
				source: "schema",
				types: ["string"],
				observedIn: 2,
			}),
			expect.objectContaining({
				label: "score",
				source: "sampled",
				types: ["number"],
				observedIn: 2,
			}),
		]);
	});

	it("sorts inferred fields by observed frequency and reports mixed types", () => {
		const fields = discoverJsonFields(undefined, [
			{ common: "one", sparse: 1 },
			{ common: "two" },
			{ common: 3 },
		]);

		expect(fields.map((field) => field.label)).toEqual(["common", "sparse"]);
		expect(fields[0]).toEqual(
			expect.objectContaining({
				source: "sampled",
				types: ["string", "number"],
				observedIn: 3,
			}),
		);
	});

	it("discovers indexed array fields and preserves unusual keys in expressions", () => {
		const fields = discoverJsonFields(undefined, [
			{
				"display-name": "Example",
				contacts: [{ email: "person@example.test" }],
			},
		]);

		expect(fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: '["display-name"]',
					templateExpression: 'item.data["display-name"]',
				}),
				expect.objectContaining({ label: "contacts", types: ["array"] }),
				expect.objectContaining({
					label: "contacts[0].email",
					templateExpression: "item.data.contacts[0].email",
					types: ["string"],
				}),
			]),
		);
	});

	it("discovers array indices beyond the first few items", () => {
		const interfaces = Array.from({ length: 10 }, (_, index) => ({
			ipv4: `192.0.2.${index}`,
			mac: `00:00:00:00:00:${index}`,
		}));

		const fields = discoverJsonFields(undefined, [{ network: { interfaces } }]);

		expect(fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "network.interfaces[9].ipv4",
					templateExpression: "item.data.network.interfaces[9].ipv4",
				}),
				expect.objectContaining({ label: "network.interfaces[9].mac" }),
			]),
		);
	});

	it("describes schema array item fields with an editable index", () => {
		const fields = discoverJsonFields(
			{
				type: "object",
				properties: {
					network: {
						type: "object",
						properties: {
							interfaces: {
								type: "array",
								items: {
									type: "object",
									properties: {
										ipv4: { type: "string" },
										mac: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
			[],
		);

		expect(fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: "network.interfaces",
					types: ["array"],
				}),
				expect.objectContaining({
					label: "network.interfaces[].ipv4",
					templateExpression: "item.data.network.interfaces[0].ipv4",
				}),
			]),
		);
	});

	it("inspects no more than the configured first samples", () => {
		const samples = Array.from({ length: 101 }, (_, index) =>
			index === 100 ? { onlyInLastSample: true } : { common: index },
		);

		const fields = discoverJsonFields(undefined, samples);

		expect(fields.map((field) => field.label)).toEqual(["common"]);
		expect(fields[0].observedIn).toBe(100);
	});

	it("builds bracket access for every non-identifier path segment", () => {
		expect(toTemplateDataExpression(["owner", "postal code", "2026"])).toBe(
			'item.data.owner["postal code"]["2026"]',
		);
	});
});
