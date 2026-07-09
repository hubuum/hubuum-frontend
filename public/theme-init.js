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
		const key = "hubuum.accent";
		const stored = window.localStorage.getItem(key);
		const accent = ["teal", "blue", "violet", "amber", "rose"].includes(
			stored,
		)
			? stored
			: "teal";
		document.documentElement.setAttribute("data-accent", accent);
	} catch {
		// Ignore accent init errors and keep CSS defaults.
	}

	try {
		const key = "hubuum.density";
		const stored = window.localStorage.getItem(key);
		const density = stored === "compact" ? "compact" : "comfortable";
		document.documentElement.setAttribute("data-density", density);
	} catch {
		// Ignore density init errors and keep CSS defaults.
	}
})();
