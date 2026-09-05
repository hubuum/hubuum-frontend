"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";

const LOGIN_BACKGROUND_STORAGE_KEY = "hubuum.login.background";
const RANDOM_BACKGROUND_ID = "random";
const BUILTIN_BACKGROUNDS = [
	{
		id: "sea",
		label: "Sunset",
		url: "/login-backgrounds/sea.webp",
		kind: "builtin",
	},
	{
		id: "mountains",
		label: "Mountains",
		url: "/login-backgrounds/mountains.webp",
		kind: "builtin",
	},
	{
		id: "clouds",
		label: "Clouds",
		url: "/login-backgrounds/clouds.webp",
		kind: "builtin",
	},
	{
		id: "forest",
		label: "Forest",
		url: "/login-backgrounds/forest.webp",
		kind: "builtin",
	},
] as const;

type LoginBackgroundOption = {
	id: string;
	label: string;
	url: string;
	kind: "builtin" | "mounted";
};

type LoginBackgroundPickerProps = {
	mountedBackgrounds: ReadonlyArray<{
		id: string;
		label: string;
		url: string;
	}>;
};

function applyBackground(background: LoginBackgroundOption) {
	const root = document.documentElement;
	if (background.kind === "mounted") {
		root.dataset.loginBackground = "mounted";
		root.style.setProperty(
			"--login-background-image",
			`url("${background.url}")`,
		);
		return;
	}

	root.dataset.loginBackground = background.id;
	root.style.removeProperty("--login-background-image");
}

function chooseRandomBackground(
	mountedBackgrounds: LoginBackgroundOption[],
): LoginBackgroundOption {
	const choices =
		mountedBackgrounds.length > 0
			? mountedBackgrounds
			: [...BUILTIN_BACKGROUNDS];
	return choices[Math.floor(Math.random() * choices.length)];
}

export function LoginBackgroundPicker({
	mountedBackgrounds,
}: LoginBackgroundPickerProps) {
	const mountedOptions = useMemo<LoginBackgroundOption[]>(
		() =>
			mountedBackgrounds.map((background) => ({
				...background,
				kind: "mounted",
			})),
		[mountedBackgrounds],
	);
	const backgrounds = useMemo<LoginBackgroundOption[]>(
		() => [...BUILTIN_BACKGROUNDS, ...mountedOptions],
		[mountedOptions],
	);
	const [selection, setSelection] = useState("sea");

	useEffect(() => {
		const stored = window.localStorage.getItem(LOGIN_BACKGROUND_STORAGE_KEY);
		if (stored === RANDOM_BACKGROUND_ID && mountedOptions.length > 0) {
			setSelection(RANDOM_BACKGROUND_ID);
			applyBackground(chooseRandomBackground(mountedOptions));
			return;
		}

		const storedBackground = backgrounds.find(
			(background) => background.id === stored,
		);
		const initialBackground = storedBackground ?? BUILTIN_BACKGROUNDS[0];
		setSelection(initialBackground.id);
		applyBackground(initialBackground);
	}, [backgrounds, mountedOptions]);

	function chooseBackground(nextSelection: string) {
		const background =
			nextSelection === RANDOM_BACKGROUND_ID
				? chooseRandomBackground(mountedOptions)
				: backgrounds.find((item) => item.id === nextSelection);
		if (!background) {
			return;
		}

		setSelection(nextSelection);
		applyBackground(background);
		window.localStorage.setItem(LOGIN_BACKGROUND_STORAGE_KEY, nextSelection);
	}

	const randomPreview = mountedOptions[0];

	return (
		<details className="login-appearance">
			<summary>Appearance</summary>
			<fieldset className="login-background-picker">
				<legend>Background</legend>
				<div className="login-background-options">
					{backgrounds.slice(0, BUILTIN_BACKGROUNDS.length).map((item) => (
						<button
							key={item.id}
							type="button"
							className="login-background-option"
							aria-pressed={selection === item.id}
							onClick={() => chooseBackground(item.id)}
						>
							<span
								className={`login-background-swatch login-background-swatch--${item.id}`}
								aria-hidden="true"
							/>
							<span>{item.label}</span>
						</button>
					))}
					{randomPreview ? (
						<button
							type="button"
							className="login-background-option"
							aria-pressed={selection === RANDOM_BACKGROUND_ID}
							onClick={() => chooseBackground(RANDOM_BACKGROUND_ID)}
						>
							<span
								className="login-background-swatch login-background-swatch--random"
								style={
									{
										"--login-background-preview": `url("${randomPreview.url}")`,
									} as CSSProperties
								}
								aria-hidden="true"
							/>
							<span>Random</span>
						</button>
					) : null}
					{mountedOptions.map((item) => (
						<button
							key={item.id}
							type="button"
							className="login-background-option"
							aria-pressed={selection === item.id}
							onClick={() => chooseBackground(item.id)}
						>
							<span
								className="login-background-swatch"
								style={{ backgroundImage: `url("${item.url}")` }}
								aria-hidden="true"
							/>
							<span>{item.label}</span>
						</button>
					))}
				</div>
			</fieldset>
		</details>
	);
}
