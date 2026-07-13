export type ThemePreference = "system" | "light" | "dark";

export type DensityPreference = "comfortable" | "compact";

export type AccentPreference = "teal" | "blue" | "violet" | "amber" | "rose";

export const ACCENT_OPTIONS: Array<{
	value: AccentPreference;
	label: string;
}> = [
	{ value: "teal", label: "Teal" },
	{ value: "blue", label: "Blue" },
	{ value: "violet", label: "Violet" },
	{ value: "amber", label: "Amber" },
	{ value: "rose", label: "Rose" },
];

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
	return ACCENT_OPTIONS.some((option) => option.value === value);
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference === "light" || preference === "dark") {
		return preference;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}
