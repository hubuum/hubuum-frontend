import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { createTemplateCompletionSource } from "@/lib/template-completion";

async function labelsFor(document: string): Promise<string[]> {
	const state = EditorState.create({ doc: document });
	const source = createTemplateCompletionSource({
		scopeKind: "objects_in_class",
		relationHydrated: false,
		dataFields: [
			{ path: ["active"], detail: "boolean · schema" },
			{ path: ["owner", "email"], detail: "string · sampled" },
			{ path: ["owner", "name"], detail: "string · schema" },
			{ path: ["display-name"], detail: "string · sampled" },
			{
				path: ["network", "interfaces", "[#]", "ipv4"],
				detail: "string · schema",
			},
			{
				path: ["network", "interfaces", "[#]", "mac"],
				detail: "string · schema",
			},
		],
	});
	const result = await source(
		new CompletionContext(state, document.length, true),
	);
	return result?.options.map((option) => option.label) ?? [];
}

describe("template data field completion", () => {
	it("suggests discovered top-level fields after item.data", async () => {
		await expect(
			labelsFor("{% for item in items %}{{ item.data."),
		).resolves.toEqual(["active", "network", "owner"]);
	});

	it("suggests nested discovered fields", async () => {
		await expect(
			labelsFor("{% for item in items %}{{ item.data.owner."),
		).resolves.toEqual(["email", "name"]);
	});

	it("understands numeric indices for schema array item fields", async () => {
		await expect(
			labelsFor("{% for item in items %}{{ item.data.network.interfaces[9]."),
		).resolves.toEqual(["ipv4", "mac"]);
	});
});
