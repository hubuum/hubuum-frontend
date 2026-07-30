"use client";

import { useEffect, useState } from "react";

import {
	ATMOSPHERE_OPTIONS,
	type AtmospherePreset,
	DEFAULT_ATMOSPHERE,
	type DensityPreference,
	getAtmosphereAccent,
	isDensityPreference,
	isThemePreference,
	resolveAtmospherePreset,
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
	const [atmosphere, setAtmosphere] =
		useState<AtmospherePreset>(DEFAULT_ATMOSPHERE);

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
		if (isThemePreference(storedTheme)) setTheme(storedTheme);
		if (isDensityPreference(storedDensity)) setDensity(storedDensity);
		setAtmosphere(
			resolveAtmospherePreset(storedSecondaryAccent, storedAccent),
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

	function selectAtmosphere(value: AtmospherePreset) {
		const accent = getAtmosphereAccent(value);
		setAtmosphere(value);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.accent, accent);
		writeUserSetting(PORTABLE_USER_SETTING_KEYS.secondaryAccent, accent);
		writeDeviceSetting(DEVICE_SETTING_KEYS.loginAccent, accent);
		writeDeviceSetting(DEVICE_SETTING_KEYS.loginSecondaryAccent, accent);
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
					<h3>Workspace atmosphere</h3>
					<p className="muted">
						Choose a complete visual language for the workspace.
					</p>
				</div>
				<fieldset className="appearance-atmosphere-fieldset">
					<legend>Atmosphere</legend>
					<p className="muted">
						Each atmosphere includes purpose-built light and dark palettes for
						canvas, navigation, typography, actions and ambient detail.
					</p>
					<div className="atmosphere-options">
						{ATMOSPHERE_OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								className={`atmosphere-option ${atmosphere === option.value ? "is-selected" : ""}`}
								onClick={() => selectAtmosphere(option.value)}
								aria-pressed={atmosphere === option.value}
							>
								<span
									className={`atmosphere-option-art atmosphere-option-art--${option.value}`}
									aria-hidden="true"
								/>
								<span className="atmosphere-option-copy">
									<strong>{option.label}</strong>
									<small>{option.description}</small>
									<span className="atmosphere-option-meta">
										<span>{option.palette}</span>
										<span>Light + dark</span>
									</span>
								</span>
							</button>
						))}
					</div>
				</fieldset>
			</section>
		</div>
	);
}
