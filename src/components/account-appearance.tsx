"use client";

import { useEffect, useState } from "react";

import {
	ACCENT_OPTIONS,
	type AccentPreference,
	type DensityPreference,
	isAccentPreference,
	isDensityPreference,
	isThemePreference,
	type ThemePreference,
} from "@/lib/appearance-preferences";
import {
	writeDeviceSetting,
	writeUserSetting,
} from "@/lib/user-settings-client";
import {
	DEVICE_SETTING_KEYS,
	PORTABLE_USER_SETTING_KEYS,
} from "@/lib/user-settings-types";

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS: Array<{ value: DensityPreference; label: string }> = [
	{ value: "comfortable", label: "Comfortable" },
	{ value: "compact", label: "Compact" },
];

export function AccountAppearance() {
	const [theme, setTheme] = useState<ThemePreference>("system");
	const [density, setDensity] = useState<DensityPreference>("comfortable");
	const [accent, setAccent] = useState<AccentPreference>("teal");
	const [secondaryAccent, setSecondaryAccent] =
		useState<AccentPreference>("teal");

	useEffect(() => {
		const storedTheme = window.localStorage.getItem(
			PORTABLE_USER_SETTING_KEYS.theme,
		);
		const storedDensity = window.localStorage.getItem(
			PORTABLE_USER_SETTING_KEYS.density,
		);
		const storedAccent = window.localStorage.getItem(
			PORTABLE_USER_SETTING_KEYS.accent,
		);
		const storedSecondaryAccent = window.localStorage.getItem(
			PORTABLE_USER_SETTING_KEYS.secondaryAccent,
		);
		const resolvedAccent = isAccentPreference(storedAccent)
			? storedAccent
			: "teal";

		if (isThemePreference(storedTheme)) setTheme(storedTheme);
		if (isDensityPreference(storedDensity)) setDensity(storedDensity);
		setAccent(resolvedAccent);
		setSecondaryAccent(
			isAccentPreference(storedSecondaryAccent)
				? storedSecondaryAccent
				: resolvedAccent,
		);
	}, []);

	function selectTheme(value: ThemePreference) {
		setTheme(value);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.theme, value);
	}

	function selectDensity(value: DensityPreference) {
		setDensity(value);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.density, value);
	}

	function selectPrimaryAccent(value: AccentPreference) {
		setAccent(value);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.accent, value);
		writeDeviceSetting(DEVICE_SETTING_KEYS.loginAccent, value);
	}

	function selectSecondaryAccent(value: AccentPreference) {
		setSecondaryAccent(value);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.secondaryAccent, value);
		writeDeviceSetting(DEVICE_SETTING_KEYS.loginSecondaryAccent, value);
	}

	return (
		<div className="appearance-grid">
			<section className="card stack appearance-card">
				<div>
					<h3>Theme</h3>
					<p className="muted">
						Choose how the workspace follows your display.
					</p>
				</div>
				<fieldset className="segmented-options">
					<legend className="sr-only">Theme</legend>
					{THEME_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							className={`ghost ${theme === option.value ? "is-selected" : ""}`}
							onClick={() => selectTheme(option.value)}
							aria-pressed={theme === option.value}
						>
							{option.label}
						</button>
					))}
				</fieldset>
			</section>

			<section className="card stack appearance-card">
				<div>
					<h3>Density</h3>
					<p className="muted">
						Control row and panel spacing across data-heavy views.
					</p>
				</div>
				<fieldset className="segmented-options">
					<legend className="sr-only">Density</legend>
					{DENSITY_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							className={`ghost ${density === option.value ? "is-selected" : ""}`}
							onClick={() => selectDensity(option.value)}
							aria-pressed={density === option.value}
						>
							{option.label}
						</button>
					))}
				</fieldset>
			</section>

			<section className="card stack appearance-card appearance-card--wide">
				<div>
					<h3>Workspace colors</h3>
					<p className="muted">
						Primary colors identify actions and focus. Secondary colors tint
						navigation and the canvas.
					</p>
				</div>
				<div className="appearance-color-groups">
					<fieldset>
						<legend>Primary color</legend>
						<div className="appearance-color-options">
							{ACCENT_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`accent-option ${accent === option.value ? "is-selected" : ""}`}
									onClick={() => selectPrimaryAccent(option.value)}
									aria-pressed={accent === option.value}
								>
									<span
										className={`accent-swatch accent-swatch--${option.value}`}
										aria-hidden="true"
									/>
									<span>{option.label}</span>
								</button>
							))}
						</div>
					</fieldset>
					<fieldset>
						<legend>Secondary color</legend>
						<div className="appearance-color-options">
							{ACCENT_OPTIONS.map((option) => (
								<button
									key={option.value}
									type="button"
									className={`accent-option accent-option--secondary ${secondaryAccent === option.value ? "is-selected" : ""}`}
									onClick={() => selectSecondaryAccent(option.value)}
									aria-pressed={secondaryAccent === option.value}
								>
									<span
										className={`accent-swatch accent-swatch--${option.value}`}
										aria-hidden="true"
									/>
									<span>{option.label}</span>
								</button>
							))}
						</div>
					</fieldset>
				</div>
			</section>
		</div>
	);
}
