import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const viewports = [
	{ name: "mobile", width: 360, height: 800 },
	{ name: "tablet", width: 768, height: 900 },
	{ name: "desktop", width: 1440, height: 1000 },
] as const;

const themes = ["light", "dark"] as const;
const accents = ["teal", "blue", "violet", "amber", "rose"] as const;

async function prepareLogin(page: Page, theme: (typeof themes)[number]) {
	await page.addInitScript((selectedTheme) => {
		window.localStorage.setItem("hubuum.theme", selectedTheme);
		window.localStorage.setItem("hubuum.login.accent", "teal");
		window.localStorage.setItem("hubuum.login.secondary-accent", "teal");
	}, theme);
	await page.goto("/login");
	await expect(
		page.getByRole("heading", { name: "Welcome back" }),
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

	test("every accent keeps primary action text readable", async ({ page }) => {
		await prepareLogin(page, "light");

		for (const theme of themes) {
			for (const accent of accents) {
				const contrast = await page.evaluate(
					(selectedAccent) => {
						const button =
							document.querySelector<HTMLButtonElement>(".login-submit");
						if (!button) return 0;
						button.style.transition = "none";
						document.documentElement.dataset.theme = selectedAccent.theme;
						document.documentElement.dataset.accent = selectedAccent.accent;
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
						return (
							(Math.max(foreground, background) + 0.05) /
							(Math.min(foreground, background) + 0.05)
						);
					},
					{ accent, theme },
				);

				expect(contrast, `${theme} ${accent} contrast`).toBeGreaterThanOrEqual(
					4.5,
				);
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
});

test.describe("public visual regression", () => {
	test.skip(
		Boolean(process.env.CI),
		"Pixel snapshots are recorded locally to avoid platform font-rendering noise.",
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
});
