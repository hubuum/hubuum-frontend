import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const viewports = [
	{ name: "mobile", width: 360, height: 800 },
	{ name: "tablet", width: 768, height: 900 },
	{ name: "desktop", width: 1440, height: 1000 },
] as const;

const themes = ["light", "dark"] as const;
const atmospheres = ["sunset", "golden-hour", "clouds", "forest"] as const;

async function prepareLogin(
	page: Page,
	theme: (typeof themes)[number],
	path = "/login",
) {
	await page.route("**/_hubuum-bff/auth/providers", async (route) => {
		await route.fulfill({
			status: 503,
			contentType: "application/json",
			body: JSON.stringify({ message: "Provider discovery unavailable." }),
		});
	});
	await page.addInitScript((selectedTheme) => {
		window.localStorage.setItem("hubuum.theme", selectedTheme);
		window.localStorage.setItem("hubuum.login.accent", "rose");
		window.localStorage.setItem("hubuum.login.secondary-accent", "rose");
	}, theme);
	await page.goto(path);
	await expect(page.getByRole("form", { name: "Login form" })).toBeVisible();
	await expect(
		page.getByText(
			"Leave blank for local accounts, or enter the configured provider scope.",
		),
	).toBeVisible();
	await page.evaluate(async () => {
		await document.fonts.ready;
	});
}

test.describe("public accessibility", () => {
	for (const theme of themes) {
		test(`login has no serious accessibility violations in ${theme} mode`, async ({
			page,
		}) => {
			await prepareLogin(page, theme);
			const results = await new AxeBuilder({ page }).analyze();
			const seriousViolations = results.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			);
			expect(seriousViolations).toEqual([]);
		});
	}

	test("single-line inputs and selects share the same control height", async ({
		page,
	}) => {
		await prepareLogin(page, "light");

		async function measure(density: "comfortable" | "compact") {
			return page.evaluate(async (selectedDensity) => {
				const previousDensity = document.documentElement.dataset.density;
				if (selectedDensity === "compact") {
					document.documentElement.dataset.density = "compact";
				} else {
					delete document.documentElement.dataset.density;
				}

				const fixture = document.createElement("div");
				fixture.style.cssText =
					"position:absolute;left:-10000px;top:0;display:grid;width:320px";
				const input = document.createElement("input");
				const select = document.createElement("select");
				select.append(new Option("Text", "text"));
				const inlineEditTrigger = document.createElement("button");
				inlineEditTrigger.className = "inline-field-edit-trigger";
				inlineEditTrigger.append(
					Object.assign(document.createElement("span"), {
						className: "inline-field-edit-trigger-value",
						textContent: "Editable value",
					}),
				);
				fixture.append(input, select, inlineEditTrigger);
				document.body.append(fixture);
				await new Promise<void>((resolve) =>
					window.requestAnimationFrame(() => resolve()),
				);

				const inputStyle = getComputedStyle(input);
				const selectStyle = getComputedStyle(select);
				const measurement = {
					inputHeight: input.getBoundingClientRect().height,
					inputMinHeight: Number.parseFloat(inputStyle.minHeight),
					selectHeight: select.getBoundingClientRect().height,
					selectMinHeight: Number.parseFloat(selectStyle.minHeight),
					inlineEditHeight: inlineEditTrigger.getBoundingClientRect().height,
					inlineEditWidth: inlineEditTrigger.getBoundingClientRect().width,
					fixtureWidth: fixture.getBoundingClientRect().width,
				};
				fixture.remove();
				if (previousDensity) {
					document.documentElement.dataset.density = previousDensity;
				} else {
					delete document.documentElement.dataset.density;
				}
				return measurement;
			}, density);
		}

		const comfortable = await measure("comfortable");
		const compact = await measure("compact");
		expect(comfortable.inputHeight).toBeCloseTo(comfortable.selectHeight, 1);
		expect(comfortable.inputMinHeight).toBeCloseTo(
			comfortable.selectMinHeight,
			1,
		);
		expect(comfortable.inputHeight).toBeGreaterThanOrEqual(44);
		expect(comfortable.inlineEditWidth).toBeCloseTo(
			comfortable.fixtureWidth,
			1,
		);
		expect(comfortable.inlineEditHeight).toBeGreaterThanOrEqual(34);
		expect(compact.inputHeight).toBeCloseTo(compact.selectHeight, 1);
		expect(compact.inputMinHeight).toBeCloseTo(compact.selectMinHeight, 1);
		expect(compact.inputHeight).toBeLessThan(comfortable.inputHeight);
	});

	test("all eight atmosphere variants keep primary action text readable", async ({
		page,
	}) => {
		await prepareLogin(page, "light");

		for (const theme of themes) {
			for (const atmosphere of atmospheres) {
				const contrast = await page.evaluate(
					(selectedTheme) => {
						document.documentElement.dataset.theme = selectedTheme.theme;
						document.documentElement.dataset.atmosphere =
							selectedTheme.atmosphere;
						const button = document.createElement("button");
						button.style.cssText =
							"position:absolute;left:-10000px;background:var(--accent);color:var(--accent-contrast)";
						button.textContent = "Action";
						document.body.append(button);
						const style = getComputedStyle(button);
						const parse = (value: string) =>
							(value.match(/[\d.]+/g) ?? [])
								.slice(0, 3)
								.map((part) => Number(part) / 255);
						const luminance = (value: string) => {
							const channels = parse(value).map((channel) =>
								channel <= 0.04045
									? channel / 12.92
									: ((channel + 0.055) / 1.055) ** 2.4,
							);
							return (
								0.2126 * channels[0] +
								0.7152 * channels[1] +
								0.0722 * channels[2]
							);
						};
						const foreground = luminance(style.color);
						const background = luminance(style.backgroundColor);
						const ratio =
							(Math.max(foreground, background) + 0.05) /
							(Math.min(foreground, background) + 0.05);
						button.remove();
						return ratio;
					},
					{ atmosphere, theme },
				);

				expect(
					contrast,
					`${theme} ${atmosphere} contrast`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	for (const viewport of viewports) {
		test(`login layout fits the ${viewport.name} viewport`, async ({
			page,
		}) => {
			await page.setViewportSize(viewport);
			await prepareLogin(page, "light");

			const layout = await page.evaluate(() => {
				const form = document.querySelector<HTMLElement>(
					'form[aria-label="Login form"]',
				);
				const submit = document.querySelector<HTMLElement>(".login-submit");
				const formBounds = form?.getBoundingClientRect();
				const submitBounds = submit?.getBoundingClientRect();
				return {
					bodyWidth: document.body.scrollWidth,
					formLeft: formBounds?.left ?? -1,
					formRight: formBounds?.right ?? Number.POSITIVE_INFINITY,
					submitHeight: submitBounds?.height ?? 0,
					viewportWidth: window.innerWidth,
				};
			});

			expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
			expect(layout.formLeft).toBeGreaterThanOrEqual(0);
			expect(layout.formRight).toBeLessThanOrEqual(layout.viewportWidth);
			expect(layout.submitHeight).toBeGreaterThanOrEqual(44);
		});
	}

	test("login background choices apply immediately and persist", async ({
		page,
	}) => {
		await prepareLogin(page, "light");
		await expect(
			page.getByRole("button", { name: "Sunset", pressed: true }),
		).toBeVisible();
		await expect
			.poll(() =>
				page
					.locator(".login-submit")
					.evaluate((button) => getComputedStyle(button).backgroundColor),
			)
			.toBe("rgb(143, 63, 43)");

		await page.getByRole("button", { name: "Mountains" }).click();
		await expect(
			page.getByRole("button", { name: "Mountains", pressed: true }),
		).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					background:
						getComputedStyle(
							document.querySelector(".auth-background") as HTMLElement,
						).backgroundImage,
					buttonColor: getComputedStyle(
						document.querySelector(".login-submit") as HTMLElement,
					).backgroundColor,
					preference: document.documentElement.dataset.loginBackground,
				})),
			)
			.toEqual({
				background: expect.stringContaining("mountains.webp"),
				buttonColor: "rgb(118, 84, 56)",
				preference: "mountains",
			});

		await page.getByRole("button", { name: "Clouds" }).click();
		await expect
			.poll(() =>
				page
					.locator(".login-submit")
					.evaluate((button) => getComputedStyle(button).backgroundColor),
			)
			.toBe("rgb(47, 88, 164)");

		await page
			.getByRole("button", { name: "Forest", exact: true })
			.click();
		await expect
			.poll(() =>
				page.evaluate(() => ({
					background:
						getComputedStyle(
							document.querySelector(".auth-background") as HTMLElement,
						).backgroundImage,
					buttonColor: getComputedStyle(
						document.querySelector(".login-submit") as HTMLElement,
					).backgroundColor,
					preference: document.documentElement.dataset.loginBackground,
				})),
			)
			.toEqual({
				background: expect.stringContaining("forest.webp"),
				buttonColor: "rgb(49, 95, 72)",
				preference: "forest",
			});

		await page.reload();
		await expect(
			page.getByRole("button", {
				name: "Forest",
				exact: true,
				pressed: true,
			}),
		).toBeVisible();
	});
});

test.describe("Stillwater design language", () => {
	test("Stillwater is the responsive, accessible product design", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 360, height: 800 });
		await prepareLogin(page, "light");

		const mobile = await page.evaluate(() => {
			const form = document.querySelector<HTMLElement>(
				'form[aria-label="Login form"]',
			);
			const formBounds = form?.getBoundingClientRect();
			return {
				bodyWidth: document.body.scrollWidth,
				designVariant: document.documentElement.dataset.designVariant,
				fontFamily: form ? getComputedStyle(form).fontFamily : "",
				formLeft: formBounds?.left ?? -1,
				formRight: formBounds?.right ?? Number.POSITIVE_INFINITY,
				viewportWidth: window.innerWidth,
			};
		});

		expect(mobile.designVariant).toBe("v6");
		expect(mobile.fontFamily).toContain("Variable");
		expect(mobile.bodyWidth).toBeLessThanOrEqual(mobile.viewportWidth);
		expect(mobile.formLeft).toBeGreaterThanOrEqual(0);
		expect(mobile.formRight).toBeLessThanOrEqual(mobile.viewportWidth);

		const seriousViolations = (
			await new AxeBuilder({ page }).analyze()
		).violations.filter((violation) =>
			["serious", "critical"].includes(violation.impact ?? ""),
		);
		expect(seriousViolations).toEqual([]);
	});

	test("legacy design-study paths redirect to the canonical product", async ({
		page,
	}) => {
		await page.goto("/v2/login");
		await expect(page).toHaveURL(/\/login$/);
	});

	test("four atmospheres produce eight complete, distinct palettes", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await prepareLogin(page, "light");

		const atmosphere = await page.evaluate(() => {
			const root = document.documentElement;
			const specimen = document.createElement("header");
			specimen.className = "topbar card";
			document.body.append(specimen);

			const read = (
				theme: "light" | "dark",
				preset: "sunset" | "golden-hour" | "clouds" | "forest",
			) => {
				root.dataset.theme = theme;
				root.dataset.atmosphere = preset;
				const rootStyle = getComputedStyle(root);
				return {
					accent: rootStyle.getPropertyValue("--accent").trim(),
					background: rootStyle.getPropertyValue("--bg").trim(),
					card: rootStyle.getPropertyValue("--card").trim(),
					haze: rootStyle.getPropertyValue("--stillwater-haze").trim(),
					ink: rootStyle.getPropertyValue("--ink").trim(),
					surface: getComputedStyle(specimen).backgroundImage,
				};
			};

			const result = {
				darkClouds: read("dark", "clouds"),
				darkForest: read("dark", "forest"),
				darkGoldenHour: read("dark", "golden-hour"),
				darkSunset: read("dark", "sunset"),
				lightClouds: read("light", "clouds"),
				lightForest: read("light", "forest"),
				lightGoldenHour: read("light", "golden-hour"),
				lightSunset: read("light", "sunset"),
			};
			specimen.remove();
			return result;
		});

		expect(
			new Set(
				Object.values(atmosphere).map((palette) => JSON.stringify(palette)),
		).size,
		).toBe(8);
	});

	test("all light-theme navigation labels keep readable contrast", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await prepareLogin(page, "light");

		for (const atmosphere of atmospheres) {
			const contrast = await page.evaluate((preset) => {
				document.documentElement.dataset.atmosphere = preset;
				const topbar = document.createElement("header");
				topbar.className = "topbar card";
				const menu = document.createElement("div");
				menu.className = "topology-nav-menu";
				const trigger = document.createElement("button");
				trigger.className = "topology-nav-trigger";
				trigger.textContent = "Administration";
				const surface = document.createElement("span");
				surface.style.background =
					"color-mix(in srgb, var(--accent) 28%, var(--card))";
				menu.append(trigger);
				topbar.append(menu, surface);
				document.body.append(topbar);

				const toRgb = (color: string) => {
					const canvas = document.createElement("canvas");
					canvas.width = 1;
					canvas.height = 1;
					const context = canvas.getContext("2d");
					if (!context) {
						throw new Error("Canvas context unavailable");
					}
					context.fillStyle = color;
					context.fillRect(0, 0, 1, 1);
					return Array.from(
						context.getImageData(0, 0, 1, 1).data.slice(0, 3),
					);
				};
				const luminance = (channels: number[]) =>
					channels
						.map((channel) => channel / 255)
						.map((channel) =>
							channel <= 0.04045
								? channel / 12.92
								: ((channel + 0.055) / 1.055) ** 2.4,
						)
						.reduce(
							(total, channel, index) =>
								total + channel * [0.2126, 0.7152, 0.0722][index],
							0,
						);
				const foreground = luminance(toRgb(getComputedStyle(trigger).color));
				const background = luminance(
					toRgb(getComputedStyle(surface).backgroundColor),
				);
				topbar.remove();
				return (
					(Math.max(foreground, background) + 0.05) /
					(Math.min(foreground, background) + 0.05)
				);
			}, atmosphere);

			expect(contrast, atmosphere).toBeGreaterThanOrEqual(4.5);
		}
	});

	test("profile menu remains substantially opaque", async ({ page }) => {
		await prepareLogin(page, "light");

		for (const theme of themes) {
			const opacity = await page.evaluate((selectedTheme) => {
				document.documentElement.dataset.theme = selectedTheme;
				const menu = document.createElement("section");
				menu.className = "user-menu card";
				document.body.append(menu);
				const canvas = document.createElement("canvas");
				canvas.width = 1;
				canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) {
					throw new Error("Canvas context unavailable");
				}
				context.clearRect(0, 0, 1, 1);
				context.fillStyle = getComputedStyle(menu).backgroundColor;
				context.fillRect(0, 0, 1, 1);
				const alpha = context.getImageData(0, 0, 1, 1).data[3] / 255;
				menu.remove();
				return alpha;
			}, theme);

			expect(opacity, theme).toBeGreaterThanOrEqual(0.95);
		}
	});
});

test.describe("public visual regression", () => {
	test.skip(
		process.env.VISUAL_REGRESSION !== "1",
		"Pixel snapshots run only in the pinned visual-regression container.",
	);

	for (const viewport of viewports) {
		for (const theme of themes) {
			test(`login ${viewport.name} ${theme}`, async ({ page }) => {
				await page.setViewportSize(viewport);
				await prepareLogin(page, theme);
				await expect(page).toHaveScreenshot(
					`login-${viewport.name}-${theme}.png`,
					{
						animations: "disabled",
						fullPage: true,
						maxDiffPixelRatio: 0.01,
					},
				);
			});
		}
	}

	for (const theme of themes) {
		test(`login forest desktop ${theme}`, async ({ page }) => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await prepareLogin(page, theme);
			await page
				.getByRole("button", { name: "Forest", exact: true })
				.click();
			await expect(page.locator(".auth-background")).toHaveCSS(
				"background-image",
				/forest\.webp/,
			);
			await expect(page).toHaveScreenshot(
				`login-forest-desktop-${theme}.png`,
				{
					animations: "disabled",
					fullPage: true,
					maxDiffPixelRatio: 0.01,
				},
			);
		});
	}
});
