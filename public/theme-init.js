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
		const stored =
			window.localStorage.getItem("hubuum.accent") ??
			window.localStorage.getItem("hubuum.login.accent");
		const accent = ["teal", "blue", "violet", "amber", "rose"].includes(stored)
			? stored
			: "teal";
		document.documentElement.setAttribute("data-accent", accent);
		const storedSecondary =
			window.localStorage.getItem("hubuum.secondary-accent") ??
			window.localStorage.getItem("hubuum.login.secondary-accent");
		const secondaryAccent = [
			"teal",
			"blue",
			"violet",
			"amber",
			"rose",
		].includes(storedSecondary)
			? storedSecondary
			: accent;
		document.documentElement.setAttribute(
			"data-secondary-accent",
			secondaryAccent,
		);
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
