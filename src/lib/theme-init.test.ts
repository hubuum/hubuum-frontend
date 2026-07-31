import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const themeInitSource = readFileSync(
	new URL("../../public/theme-init.js", import.meta.url),
	"utf8",
);

function runThemeInit(storage: Record<string, string>): Record<string, string> {
	const attributes: Record<string, string> = {};
	const properties: Record<string, string> = {};
	runInNewContext(themeInitSource, {
		document: {
			documentElement: {
				setAttribute(name: string, value: string) {
					attributes[name] = value;
				},
				style: {
					setProperty(name: string, value: string) {
						properties[name] = value;
					},
				},
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
	it("restores supported text sizes and defaults invalid values", () => {
		expect(
			runThemeInit({ "hubuum.font-size": "110" })["data-font-size"],
		).toBe("110");
		expect(
			runThemeInit({ "hubuum.font-size": "huge" })["data-font-size"],
		).toBe("100");
		expect(runThemeInit({})["data-font-size"]).toBe("100");
	});

	it("migrates unsupported device colors to the Sunset theme", () => {
		const attributes = runThemeInit({ "hubuum.login.accent": "violet" });
		expect(attributes["data-atmosphere"]).toBe("sunset");
		expect(attributes["data-accent"]).toBe("rose");
		expect(attributes["data-secondary-accent"]).toBe("rose");
	});

	it("prefers the authenticated user's complete theme over the login hint", () => {
		const attributes = runThemeInit({
			"hubuum.accent": "blue",
			"hubuum.login.accent": "rose",
		});
		expect(attributes["data-atmosphere"]).toBe("clouds");
		expect(attributes["data-accent"]).toBe("blue");
		expect(attributes["data-secondary-accent"]).toBe("blue");
	});

	it("restores the Forest atmosphere from its compatibility accent", () => {
		const attributes = runThemeInit({
			"hubuum.accent": "pine",
		});
		expect(attributes["data-atmosphere"]).toBe("forest");
		expect(attributes["data-accent"]).toBe("pine");
		expect(attributes["data-secondary-accent"]).toBe("pine");
	});

	it("falls back to Sunset for an invalid login hint", () => {
		expect(
			runThemeInit({ "hubuum.login.accent": "chartreuse" })["data-accent"],
		).toBe("rose");
	});

	it("uses the former secondary color as the legacy atmosphere hint", () => {
		const goldenHour = runThemeInit({
			"hubuum.login.accent": "blue",
			"hubuum.login.secondary-accent": "amber",
		});
		expect(goldenHour["data-atmosphere"]).toBe("golden-hour");
		expect(goldenHour["data-accent"]).toBe("amber");
		expect(goldenHour["data-secondary-accent"]).toBe("amber");

		const sunset = runThemeInit({
			"hubuum.login.accent": "rose",
			"hubuum.login.secondary-accent": "chartreuse",
		});
		expect(sunset["data-atmosphere"]).toBe("sunset");
		expect(sunset["data-secondary-accent"]).toBe("rose");
	});

	it("maps former custom colors to the default complete theme", () => {
		expect(
			runThemeInit({ "hubuum.login.accent": "#7C68D9" })["data-accent"],
		).toBe("rose");
	});

	it("defaults to Sunset and restores a bundled login background", () => {
		expect(runThemeInit({})["data-login-background"]).toBe("sea");
		expect(
			runThemeInit({
				"hubuum.login.background": "mountains",
			})["data-login-background"],
		).toBe("mountains");
		expect(
			runThemeInit({
				"hubuum.login.background": "forest",
			})["data-login-background"],
		).toBe("forest");
	});

	it("restores a mounted login background without exposing its filesystem", () => {
		expect(
			runThemeInit({
				"hubuum.login.background": "mounted:winter%20sun.webp",
			})["data-login-background"],
		).toBe("mounted");
		expect(
			runThemeInit({
				"hubuum.login.background": "mounted:..%2Fprivate.webp",
			})["data-login-background"],
		).toBe("sea");
	});
});
