export type ThemePreference = "system" | "light" | "dark";

export type DensityPreference = "comfortable" | "compact";

export type AccentPreset =
	| "dusk"
	| "blue"
	| "violet"
	| "amber"
	| "rose"
	| "pine";

export type AccentPreference = AccentPreset | `#${string}`;

export type AtmospherePreset =
	| "sunset"
	| "golden-hour"
	| "clouds"
	| "forest";

export const DEFAULT_ACCENT: AccentPreset = "dusk";
export const DEFAULT_ATMOSPHERE: AtmospherePreset = "sunset";

export const ACCENT_OPTIONS: Array<{
	value: AccentPreset;
	label: string;
	color: string;
}> = [
	{ value: "dusk", label: "Dusk", color: "#5666c7" },
	{ value: "blue", label: "Blue", color: "#3b6bdc" },
	{ value: "violet", label: "Violet", color: "#7657d9" },
	{ value: "amber", label: "Amber", color: "#b86b10" },
	{ value: "rose", label: "Rose", color: "#bd4969" },
	{ value: "pine", label: "Pine", color: "#356a4c" },
];

export const ATMOSPHERE_OPTIONS: Array<{
	value: AtmospherePreset;
	label: string;
	description: string;
	palette: string;
	accent: AccentPreset;
}> = [
	{
		value: "sunset",
		label: "Sunset",
		description: "Ember coral, northern dusk and deep water",
		palette: "Coral · ink · pearl",
		accent: "rose",
	},
	{
		value: "golden-hour",
		label: "Golden Hour",
		description: "Sun-warmed stone, soft brass and alpine shadow",
		palette: "Brass · moss · linen",
		accent: "amber",
	},
	{
		value: "clouds",
		label: "Clouds",
		description: "Cobalt blue hour, silver mist and open sky",
		palette: "Cobalt · mist · silver",
		accent: "blue",
	},
	{
		value: "forest",
		label: "Forest",
		description: "Deep pine, quiet moss and weathered stone",
		palette: "Pine · moss · fog",
		accent: "pine",
	},
];

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function isThemePreference(
	value: string | null,
): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function isDensityPreference(
	value: string | null,
): value is DensityPreference {
	return value === "comfortable" || value === "compact";
}

export function isAccentPreference(
	value: string | null,
): value is AccentPreference {
	return (
		ACCENT_OPTIONS.some((option) => option.value === value) ||
		(value !== null && HEX_COLOR_PATTERN.test(value))
	);
}

export function normalizeAccentPreference(
	value: string | null,
): AccentPreference | null {
	if (!isAccentPreference(value)) {
		return null;
	}

	return value.startsWith("#")
		? (value.toLowerCase() as AccentPreference)
		: value;
}

export function isCustomAccentPreference(
	value: AccentPreference,
): value is `#${string}` {
	return value.startsWith("#");
}

export function getAccentColor(value: AccentPreference): string {
	if (isCustomAccentPreference(value)) {
		return value;
	}

	return (
		ACCENT_OPTIONS.find((option) => option.value === value)?.color ??
		ACCENT_OPTIONS[0].color
	);
}

export function getAtmospherePreset(
	value: AccentPreference,
): AtmospherePreset | null {
	return (
		ATMOSPHERE_OPTIONS.find((option) => option.accent === value)?.value ?? null
	);
}

export function resolveAtmospherePreset(
	...values: Array<string | null>
): AtmospherePreset {
	for (const value of values) {
		const accent = normalizeAccentPreference(value);
		if (!accent) continue;
		const atmosphere = getAtmospherePreset(accent);
		if (atmosphere) return atmosphere;
	}

	return DEFAULT_ATMOSPHERE;
}

export function getAtmosphereAccent(
	value: AtmospherePreset,
): AccentPreset {
	return (
		ATMOSPHERE_OPTIONS.find((option) => option.value === value)?.accent ??
		ATMOSPHERE_OPTIONS[0].accent
	);
}

export function getAccentContrast(color: `#${string}`): "#050608" | "#ffffff" {
	const relativeLuminance = (value: `#${string}`) => {
		const channels = [1, 3, 5].map((index) => {
			const channel = Number.parseInt(value.slice(index, index + 2), 16) / 255;
			return channel <= 0.04045
				? channel / 12.92
				: ((channel + 0.055) / 1.055) ** 2.4;
		});
		return (
			0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
		);
	};
	const luminance = relativeLuminance(color);
	const darkLuminance = relativeLuminance("#050608");
	const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
	const lightContrast = 1.05 / (luminance + 0.05);

	return darkContrast >= lightContrast ? "#050608" : "#ffffff";
}

export function applyAccentPreference(
	element: HTMLElement,
	kind: "primary" | "secondary",
	value: AccentPreference,
) {
	const attribute =
		kind === "primary" ? "data-accent" : "data-secondary-accent";
	const colorProperty =
		kind === "primary" ? "--custom-accent" : "--custom-secondary-accent";
	const contrastProperty =
		kind === "primary"
			? "--custom-accent-contrast"
			: "--custom-secondary-accent-contrast";

	if (isCustomAccentPreference(value)) {
		element.setAttribute(attribute, "custom");
		element.style.setProperty(colorProperty, value);
		element.style.setProperty(contrastProperty, getAccentContrast(value));
		return;
	}

	element.setAttribute(attribute, value);
	element.style.removeProperty(colorProperty);
	element.style.removeProperty(contrastProperty);
}

export function applyAtmospherePreference(
	element: HTMLElement,
	value: AtmospherePreset,
) {
	const accent = getAtmosphereAccent(value);
	element.setAttribute("data-atmosphere", value);
	applyAccentPreference(element, "primary", accent);
	applyAccentPreference(element, "secondary", accent);
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference === "light" || preference === "dark") {
		return preference;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}
