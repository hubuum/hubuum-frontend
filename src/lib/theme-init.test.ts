import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const themeInitSource = readFileSync(
	new URL("../../public/theme-init.js", import.meta.url),
	"utf8",
);

function runThemeInit(storage: Record<string, string>): Record<string, string> {
	const attributes: Record<string, string> = {};
	runInNewContext(themeInitSource, {
		document: {
			documentElement: {
				setAttribute(name: string, value: string) {
					attributes[name] = value;
				},
				style: {},
			},
		},
		window: {
			localStorage: {
				getItem(key: string) {
					return storage[key] ?? null;
				},
			},
			matchMedia() {
				return { matches: false };
			},
		},
	});
	return attributes;
}

describe("theme initialization", () => {
	it("uses the device login accent when no authenticated cache exists", () => {
		const attributes = runThemeInit({ "hubuum.login.accent": "violet" });
		expect(attributes["data-accent"]).toBe("violet");
		expect(attributes["data-secondary-accent"]).toBe("violet");
	});

	it("prefers the authenticated user's accent over the login hint", () => {
		expect(
			runThemeInit({
				"hubuum.accent": "blue",
				"hubuum.login.accent": "rose",
			})["data-accent"],
		).toBe("blue");
	});

	it("falls back to teal for an invalid login hint", () => {
		expect(
			runThemeInit({ "hubuum.login.accent": "chartreuse" })["data-accent"],
		).toBe("teal");
	});

	it("loads an independent secondary color and validates its fallback", () => {
		expect(
			runThemeInit({
				"hubuum.login.accent": "blue",
				"hubuum.login.secondary-accent": "amber",
			})["data-secondary-accent"],
		).toBe("amber");
		expect(
			runThemeInit({
				"hubuum.login.accent": "rose",
				"hubuum.login.secondary-accent": "chartreuse",
			})["data-secondary-accent"],
		).toBe("rose");
	});
});
