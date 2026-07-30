import { describe, expect, it } from "vitest";

import {
	applyAccentPreference,
	applyAtmospherePreference,
	ATMOSPHERE_OPTIONS,
	getAccentColor,
	getAccentContrast,
	getAtmosphereAccent,
	getAtmospherePreset,
	isAccentPreference,
	normalizeAccentPreference,
	resolveAtmospherePreset,
} from "@/lib/appearance-preferences";

describe("appearance preferences", () => {
	it("accepts named and six-digit custom colors", () => {
		expect(isAccentPreference("dusk")).toBe(true);
		expect(isAccentPreference("#8A73E6")).toBe(true);
		expect(isAccentPreference("teal")).toBe(false);
		expect(isAccentPreference("#abc")).toBe(false);
	});

	it("normalizes custom colors without changing named presets", () => {
		expect(normalizeAccentPreference("#8A73E6")).toBe("#8a73e6");
		expect(normalizeAccentPreference("violet")).toBe("violet");
		expect(normalizeAccentPreference("chartreuse")).toBeNull();
	});

	it("provides stable picker colors and readable foregrounds", () => {
		expect(getAccentColor("dusk")).toBe("#5666c7");
		expect(getAccentColor("#8a73e6")).toBe("#8a73e6");
		expect(getAccentContrast("#f6d365")).toBe("#050608");
		expect(getAccentContrast("#35418f")).toBe("#ffffff");
		expect(getAccentContrast("#777777")).toBe("#050608");
	});

	it("maps the four complete themes to stable legacy storage accents", () => {
		expect(ATMOSPHERE_OPTIONS.map((option) => option.accent)).toEqual([
			"rose",
			"amber",
			"blue",
			"pine",
		]);
		expect(getAtmospherePreset("rose")).toBe("sunset");
		expect(getAtmospherePreset("amber")).toBe("golden-hour");
		expect(getAtmospherePreset("blue")).toBe("clouds");
		expect(getAtmospherePreset("pine")).toBe("forest");
		expect(getAtmosphereAccent("sunset")).toBe("rose");
		expect(getAtmosphereAccent("forest")).toBe("pine");
		expect(getAtmospherePreset("dusk")).toBeNull();
		expect(getAtmospherePreset("violet")).toBeNull();
		expect(getAtmospherePreset("#2f7881")).toBeNull();
		expect(resolveAtmospherePreset("amber", "blue")).toBe("golden-hour");
		expect(resolveAtmospherePreset("violet", "#2f7881")).toBe("sunset");
	});

	it("applies custom colors and clears them when a preset is selected", () => {
		const attributes = new Map<string, string>();
		const properties = new Map<string, string>();
		const element = {
			dataset: {},
			setAttribute(name: string, value: string) {
				attributes.set(name, value);
			},
			style: {
				getPropertyValue(name: string) {
					return properties.get(name) ?? "";
				},
				removeProperty(name: string) {
					const previous = properties.get(name) ?? "";
					properties.delete(name);
					return previous;
				},
				setProperty(name: string, value: string) {
					properties.set(name, value);
				},
			},
		} as unknown as HTMLElement;

		applyAccentPreference(element, "primary", "#35418f");
		expect(attributes.get("data-accent")).toBe("custom");
		expect(element.style.getPropertyValue("--custom-accent")).toBe("#35418f");
		expect(element.style.getPropertyValue("--custom-accent-contrast")).toBe(
			"#ffffff",
		);

		applyAccentPreference(element, "primary", "dusk");
		expect(attributes.get("data-accent")).toBe("dusk");
		expect(element.style.getPropertyValue("--custom-accent")).toBe("");

		applyAtmospherePreference(element, "clouds");
		expect(attributes.get("data-atmosphere")).toBe("clouds");
		expect(attributes.get("data-accent")).toBe("blue");
		expect(attributes.get("data-secondary-accent")).toBe("blue");
	});
});
