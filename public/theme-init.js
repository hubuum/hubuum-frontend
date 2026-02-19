(() => {
  try {
    const key = "hubuum.theme";
    const stored = window.localStorage.getItem(key);
    const preference =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    const resolved =
      preference === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : preference;
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.style.colorScheme = resolved;
  } catch {
    // Ignore theme init errors and keep CSS defaults.
  }
})();
