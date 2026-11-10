import { afterEach, describe, expect, it, vi } from "vitest";

import {
	fetchRuntimeSettingsCatalogue,
	fetchRuntimeSettingsGroup,
	runtimeChanges,
	runtimeDraftCount,
	runtimeFields,
	saveRuntimeSettings,
	type RuntimeSettingsDescriptor,
} from "./runtime-settings";

const descriptor: RuntimeSettingsDescriptor = {
	key: "future_policy",
	title: "Future policy",
	description: "Added later",
	patch_supported: true,
	requires_local_admin: false,
	takes_effect: "next_request",
	read_only_reason: null,
	schema: {
		type: "object",
		properties: {
			new_option: {
				type: "integer",
				minimum: 1,
				maximum: 20,
				"x-future": true,
			},
			enabled: { type: "boolean" },
			opaque: { type: "object" },
		},
	},
};
afterEach(() => vi.unstubAllGlobals());
describe("runtime configuration discovery", () => {
	it("accepts the optional read-only explanation being omitted", async () => {
		const { read_only_reason: _, ...advertised } = descriptor;
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ schema_version: 1, groups: [advertised] }),
				),
		);
		expect((await fetchRuntimeSettingsCatalogue())?.groups[0]).toEqual(
			advertised,
		);
	});
	it("normalizes unavailable optional group values without enabling edits", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				Response.json({
					group: "future_policy",
					source: "deployment",
					mutable: true,
					restart_required: false,
					takes_effect: "next_request",
					replica: { status: "unavailable" },
					effective: {},
					constrained_by_ceiling: false,
				}),
			),
		);
		expect(await fetchRuntimeSettingsGroup("future_policy")).toMatchObject({
			revision: null,
			runtime: null,
			deployment: null,
		});
	});
	it("preserves field help and descriptions for advertised enum choices", () => {
		const schema = {
			properties: {
				backend: {
					type: "string",
					title: "Policy engine",
					description: "Choose how permissions are evaluated.",
					enum: ["local", "future"],
					"x-enum-descriptions": {
						local: "Use built-in permissions.",
						future: "Use the new policy engine.",
						unavailable: "Do not advertise this choice.",
					},
				},
			},
		};
		expect(runtimeFields({ ...descriptor, schema })[0]).toMatchObject({
			title: "Policy engine",
			description: "Choose how permissions are evaluated.",
			choices: ["local", "future"],
			choiceDescriptions: {
				local: "Use built-in permissions.",
				future: "Use the new policy engine.",
			},
		});
	});
	it("keeps enums usable when older servers omit choice help", () => {
		const schema = {
			properties: { backend: { type: "string", enum: ["local"] } },
		};
		expect(runtimeFields({ ...descriptor, schema })[0]).toMatchObject({
			kind: "enum",
			choices: ["local"],
			choiceDescriptions: {},
		});
	});
	it.each([250, 1000])(
		"shows and enforces the advertised pagination maximum of %s",
		(maximum) => {
			const pagination: RuntimeSettingsDescriptor = {
				...descriptor,
				key: "pagination",
				schema: {
					properties: {
						default_page_limit: {
							type: "integer",
							title: "Default page size",
							description: "Maximum items when a request omits its limit.",
							minimum: 1,
							maximum,
						},
					},
				},
			};
			expect(runtimeFields(pagination)[0]).toMatchObject({
				minimum: 1,
				maximum,
				description: `Maximum items when a request omits its limit. (Deployment maximum: ${maximum.toLocaleString()} items.)`,
			});
			expect(() =>
				runtimeChanges(
					pagination,
					{ default_page_limit: String(maximum + 1) },
					{ default_page_limit: 50 },
				),
			).toThrow(`Default page size must be at most ${maximum}.`);
			expect(
				runtimeChanges(
					pagination,
					{ default_page_limit: String(maximum) },
					{ default_page_limit: 50 },
				),
			).toEqual({ default_page_limit: maximum });
		},
	);
	it("does not invent a pagination maximum when the catalogue omits it", () => {
		const pagination = {
			...descriptor,
			key: "pagination",
			schema: {
				properties: {
					default_page_limit: { type: "integer", description: "Page size." },
				},
			},
		};
		expect(runtimeFields(pagination)[0]).toMatchObject({
			description: "Page size.",
			maximum: undefined,
		});
	});
	it("edits newly discovered fields while preserving unedited and unsupported values", () => {
		expect(
			runtimeChanges(
				descriptor,
				{ new_option: "12", opaque: "ignored" },
				{ new_option: 5, enabled: true, opaque: {} },
			),
		).toEqual({ new_option: 12 });
		expect(
			runtimeFields(descriptor).find((field) => field.name === "opaque")?.kind,
		).toBe("readonly");
	});
	it.each(["", "0", "21", "1.5", "NaN", "9007199254740993"])(
		"rejects invalid integer input %s",
		(value) => {
			expect(() =>
				runtimeChanges(descriptor, { new_option: value }, {}),
			).toThrow();
		},
	);
	it("does not send unchanged fields", () => {
		expect(
			runtimeChanges(
				descriptor,
				{ new_option: "5", enabled: true },
				{ new_option: 5, enabled: true },
			),
		).toEqual({});
	});
	it("counts changed and invalid drafts without counting reverted or read-only values", () => {
		const initial = { new_option: 5, enabled: true, opaque: {} };
		expect(runtimeDraftCount(descriptor, {}, initial)).toBe(0);
		expect(
			runtimeDraftCount(
				descriptor,
				{ new_option: "05", enabled: true },
				initial,
			),
		).toBe(0);
		expect(
			runtimeDraftCount(
				descriptor,
				{ new_option: "12", enabled: false, opaque: "ignored" },
				initial,
			),
		).toBe(2);
		for (const new_option of ["", "NaN", "1.5", "21"]) {
			expect(runtimeDraftCount(descriptor, { new_option }, initial)).toBe(1);
		}
	});
	it("keeps unfamiliar composed schemas read-only", () => {
		const schema = {
			properties: { value: { type: "string", oneOf: [{ const: "x" }] } },
		};
		expect(runtimeFields({ ...descriptor, schema })[0].kind).toBe("readonly");
	});
	it("keeps groups with unsupported composition read-only", () => {
		const schema = {
			...descriptor.schema,
			oneOf: [{ required: ["new_option"] }],
		};
		expect(
			runtimeChanges({ ...descriptor, schema }, { new_option: "12" }, {}),
		).toEqual({});
	});
	it("only submits explicitly edited keys even when names match object properties", () => {
		const schema = {
			type: "object",
			properties: { constructor: { type: "string" } },
		};
		expect(runtimeChanges({ ...descriptor, schema }, {}, {})).toEqual({});
	});
	it("treats discovery 404 as an older server without falling back to writes", async () => {
		const fetch = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
		vi.stubGlobal("fetch", fetch);
		expect(await fetchRuntimeSettingsCatalogue()).toBeNull();
		expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("keeps edits behind the BFF and sends only the supplied revision and fields", async () => {
		const fetch = vi.fn().mockResolvedValue(
			Response.json({
				committed_revision: 5,
				applied_by_responding_replica: false,
			}),
		);
		vi.stubGlobal("fetch", fetch);
		await saveRuntimeSettings("future_policy", 4, { new_option: 12 });
		expect(fetch).toHaveBeenCalledWith(
			"/_hubuum-bff/hubuum/api/v1/admin/runtime-settings/future_policy",
			expect.objectContaining({
				method: "PATCH",
				credentials: "include",
				body: JSON.stringify({
					expected_revision: 4,
					changes: { new_option: 12 },
				}),
			}),
		);
	});
	it("reports a stale edit without silently refetching or retrying", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValue(
				Response.json({ current_revision: 5 }, { status: 412 }),
			);
		vi.stubGlobal("fetch", fetch);
		await expect(
			saveRuntimeSettings("future_policy", 4, { new_option: 12 }),
		).rejects.toThrow("Reload settings");
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
