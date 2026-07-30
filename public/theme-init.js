(() => {
	try {
		const key = "hubuum.theme";
		const stored = window.localStorage.getItem(key);
		const preference =
			stored === "light" || stored === "dark" || stored === "system"
				? stored
				: "system";
		const resolved =
			preference === "system"
				? window.matchMedia("(prefers-color-scheme: dark)").matches
					? "dark"
					: "light"
				: preference;
		document.documentElement.setAttribute("data-theme", resolved);
		document.documentElement.style.colorScheme = resolved;
	} catch {
		// Ignore theme init errors and keep CSS defaults.
	}

	try {
		const atmosphereByAccent = {
			rose: "sunset",
			amber: "golden-hour",
			blue: "clouds",
			pine: "forest",
		};
		const accentByAtmosphere = {
			sunset: "rose",
			"golden-hour": "amber",
			clouds: "blue",
			forest: "pine",
		};
		const primaryAccent =
			window.localStorage.getItem("hubuum.accent") ??
			window.localStorage.getItem("hubuum.login.accent");
		const secondaryAccent =
			window.localStorage.getItem("hubuum.secondary-accent") ??
			window.localStorage.getItem("hubuum.login.secondary-accent");
		const atmosphere =
			atmosphereByAccent[secondaryAccent] ??
			atmosphereByAccent[primaryAccent] ??
			"sunset";
		const accent = accentByAtmosphere[atmosphere];
		document.documentElement.setAttribute("data-atmosphere", atmosphere);
		document.documentElement.setAttribute("data-accent", accent);
		document.documentElement.setAttribute("data-secondary-accent", accent);
	} catch {
		// Ignore atmosphere init errors and keep CSS defaults.
	}

	try {
		const key = "hubuum.density";
		const stored = window.localStorage.getItem(key);
		const density = stored === "compact" ? "compact" : "comfortable";
		document.documentElement.setAttribute("data-density", density);
	} catch {
		// Ignore density init errors and keep CSS defaults.
	}

	try {
		const stored = window.localStorage.getItem("hubuum.login.background");
		if (["sea", "mountains", "clouds", "forest"].includes(stored)) {
			document.documentElement.setAttribute("data-login-background", stored);
			return;
		}

		if (stored?.startsWith("mounted:")) {
			const encodedFilename = stored.slice("mounted:".length);
			const filename = decodeURIComponent(encodedFilename);
			const isSupported =
				filename.length > 0 &&
				filename.length <= 240 &&
				!filename.startsWith(".") &&
				!filename.includes("/") &&
				!filename.includes("\\") &&
				encodeURIComponent(filename) === encodedFilename &&
				/\.(avif|jpe?g|png|webp)$/i.test(filename);
			if (isSupported) {
				document.documentElement.setAttribute(
					"data-login-background",
					"mounted",
				);
				document.documentElement.style.setProperty(
					"--login-background-image",
					`url("/login-backgrounds/custom/${encodedFilename}")`,
				);
				return;
			}
		}

		document.documentElement.setAttribute("data-login-background", "sea");
	} catch {
		// Ignore login background errors and keep the sea default.
	}
})();
