import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";

test.describe("authenticated workspace", () => {
	test.skip(
		!username || !password,
		"Set E2E_USERNAME and E2E_PASSWORD to run authenticated flows.",
	);

	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		const provider = page.locator("#identity-scope");
		await expect(provider).toBeVisible();
		const providerSelect = page.locator("select#identity-scope");
		if (await providerSelect.isVisible()) {
			await providerSelect.selectOption(identityScope);
		} else {
			await provider.fill(identityScope);
		}
		await page.getByLabel("Username").fill(username ?? "");
		await page.getByLabel("Password").fill(password ?? "");
		await page.getByRole("button", { name: "Enter workspace" }).click();
		await page.waitForURL("**/app");
	});

	test("dashboard has no serious accessibility violations", async ({
		page,
	}) => {
		const results = await new AxeBuilder({ page }).analyze();
		expect(
			results.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			),
		).toEqual([]);
	});

	test("mobile search traps and restores focus", async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.reload();
		const trigger = page.getByRole("button", { name: "Search workspace" });
		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "Search workspace" });
		await expect(dialog).toBeVisible();
		await expect(page.locator("#mobile-workspace-search")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("Escape closes the active account menu and restores focus", async ({
		page,
	}) => {
		const trigger = page.getByRole("button", {
			name: /Open account menu for/,
		});
		await trigger.click();
		await expect(page.getByLabel("User menu")).toBeVisible();

		await page.keyboard.press("Escape");

		await expect(page.getByLabel("User menu")).toBeHidden();
		await expect(trigger).toBeFocused();
	});

	test("account menu mirrors the account section tabs", async ({ page }) => {
		await page.goto("/account");
		const expected = [
			["/account", "Profile", "Identity"],
			["/account/appearance", "Appearance", "Interface"],
			["/account/tokens", "Tokens", "Credentials"],
			["/account/service-accounts", "Service accounts", "Automation"],
			["/account/groups", "Groups", "Membership"],
			["/account/permissions", "Permissions", "Access"],
		];
		const trigger = page.getByRole("button", {
			name: /Open account menu for/,
		});
		await trigger.click();
		const links = page.locator(".menu-navigation-group .menu-nav-item");
		await expect(links).toHaveCount(expected.length);
		expect(
			await links.evaluateAll((elements) =>
				elements.map((element) => [
					element.getAttribute("href"),
					element.querySelector("strong")?.textContent,
					element.querySelector("small")?.textContent,
				]),
			),
		).toEqual(expected);
	});

	test("Data navigation opens scalable class-aware pull-outs", async ({
		page,
	}) => {
		await page.route(
			"**/_hubuum-bff/hubuum/api/v1/classes?**",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([
						{
							id: 17,
							name: "Devices",
							description: "Managed devices",
							collection: { id: 3, name: "Infrastructure" },
							validate_schema: false,
							json_schema: null,
						},
					]),
				});
			},
		);

		await page
			.getByRole("button", { name: "Data", exact: true })
			.click();

		const classesLink = page.getByRole("link", {
			name: "Classes: define object schemas inside collections",
		});
		await expect(classesLink).toHaveAttribute("href", "/classes");
		await classesLink.focus();
		const classPullout = page.getByRole("region", {
			name: "Classes navigation",
		});
		await expect(classPullout.getByText("Class definitions")).toBeVisible();
		await expect(
			classPullout.getByRole("link", { name: "Browse all" }),
		).toHaveCount(0);
		await expect(
			classPullout.locator('a[href="/classes/17"]'),
		).toContainText("Devices");

		const objectsLink = page.getByRole("link", {
			name: "Objects: manage instances within classes",
		});
		await expect(objectsLink).toHaveAttribute("href", "/objects");
		await objectsLink.focus();
		const objectPullout = page.getByRole("region", {
			name: "Objects navigation",
		});
		await expect(
			objectPullout.getByRole("link", { name: "Browse all" }),
		).toHaveCount(0);
		await expect(
			objectPullout.locator('a[href="/objects?classId=17"]'),
			).toContainText("Devices");
	});

	test("Administration navigation groups identity and operations", async ({
		page,
	}) => {
		await page
			.getByRole("button", { name: "Administration", exact: true })
			.click();

		const iamTrigger = page.getByRole("button", {
			name: "IAM: manage users, groups, and service accounts",
		});
		await iamTrigger.click();
		const iamPullout = page.getByRole("region", { name: "IAM navigation" });
		await expect(iamPullout.getByRole("link", { name: /Users:/ })).toBeVisible();
		await expect(iamPullout.getByRole("link", { name: /Groups:/ })).toBeVisible();
		await expect(
			iamPullout.getByRole("link", { name: /Service accounts:/ }),
		).toBeVisible();

		await expect(
			page.getByRole("button", {
				name: "Operations: manage remote targets and event delivery",
			}),
		).toBeVisible();
		await expect(
			page.getByRole("button", {
				name: "System: inspect configuration and manage backups",
			}),
		).toBeVisible();
	});

	test("topology dropdowns share left-edge anchoring", async ({ page }) => {
		for (const label of ["Administration", "Observe"]) {
			const trigger = page.getByRole("button", { name: label, exact: true });
			await trigger.click();
			const menu = trigger.locator("..").locator(".topology-nav-menu-items");
			await expect(menu).toBeVisible();
			await expect
				.poll(() =>
					menu.evaluate((element) => getComputedStyle(element).left),
				)
				.toBe("0px");
			await trigger.click();
		}
	});

	test("workspace atmosphere survives an immediate page refresh", async ({
		page,
	}) => {
		await page.goto("/account/appearance");
		await expect(page.locator(".topbar-heading")).toHaveCount(0);
		await expect(
			page.locator("#main-content .eyebrow", { hasText: "Account" }),
		).toHaveCount(0);
		const atmosphere = page.getByRole("group", { name: "Atmosphere" });
		const selectedLabel =
			(
				await atmosphere
					.locator('button[aria-pressed="true"] strong')
					.textContent()
			)?.trim() ?? "Sunset";
		const target =
			selectedLabel === "Forest"
				? { accent: "amber", label: "Golden Hour", value: "golden-hour" }
				: { accent: "pine", label: "Forest", value: "forest" };
		const original =
			selectedLabel === "Golden Hour"
				? { accent: "amber", label: "Golden Hour", value: "golden-hour" }
				: selectedLabel === "Clouds"
					? { accent: "blue", label: "Clouds", value: "clouds" }
					: selectedLabel === "Forest"
						? { accent: "pine", label: "Forest", value: "forest" }
					: { accent: "rose", label: "Sunset", value: "sunset" };

		try {
			await atmosphere
				.getByRole("button", { name: target.label })
				.click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-atmosphere",
				target.value,
			);
			await expect(page.locator("html")).toHaveAttribute(
				"data-accent",
				target.accent,
			);
			await expect(page.locator("html")).toHaveAttribute(
				"data-secondary-accent",
				target.accent,
			);

			await page.reload();

			await expect(page.locator("html")).toHaveAttribute(
				"data-atmosphere",
				target.value,
			);
			await expect(
				page
					.getByRole("group", { name: "Atmosphere" })
					.getByRole("button", { name: target.label }),
			).toHaveAttribute("aria-pressed", "true");
		} finally {
			await page.goto("/account/appearance");
			await page
				.getByRole("group", { name: "Atmosphere" })
				.getByRole("button", { name: original.label })
				.click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-atmosphere",
				original.value,
			);
			await page.waitForTimeout(300);
		}
	});

	test("mobile resource pages expose one primary create action", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/collections");
		await expect(page.locator(".topbar .create-button")).toBeHidden();
		await expect(
			page.locator(".resource-index .resource-index-create"),
		).toBeHidden();
		await expect(page.locator(".fab--create")).toBeVisible();
	});

	test("resource filter actions stay inside their cards", async ({ page }) => {
		const resources = [
			{
				path: "/classes",
				action: "Filter classes",
			},
			{
				path: "/objects?classId=1",
				action: "Find objects on this page",
			},
		] as const;

		for (const width of [1440, 1100, 901, 768, 390]) {
			await page.setViewportSize({ width, height: 900 });

			for (const resource of resources) {
				await page.goto(resource.path);
				const card = page.locator(".resource-index").first();
				const action = page.getByRole("button", {
					name: resource.action,
				});
				await expect(card).toBeVisible();
				await expect(action).toBeVisible();

				const bounds = await Promise.all([
					card.boundingBox(),
					action.boundingBox(),
				]);
				expect(bounds[0]).not.toBeNull();
				expect(bounds[1]).not.toBeNull();
				expect(bounds[1]?.x ?? 0).toBeGreaterThanOrEqual(
					(bounds[0]?.x ?? 0) - 1,
				);
				expect(
					(bounds[1]?.x ?? 0) + (bounds[1]?.width ?? 0),
				).toBeLessThanOrEqual(
					(bounds[0]?.x ?? 0) + (bounds[0]?.width ?? 0) + 1,
				);
			}
		}
	});

	test("table resizing preserves columns to the left", async ({ page }) => {
		const timestamp = "2026-07-29T12:00:00Z";
		const collection = {
			id: 1,
			name: "Root",
			description: "",
			parent_collection_id: null,
			created_at: timestamp,
			updated_at: timestamp,
		};
		await page.route("**/api/v1/classes?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: {
					"X-Total-Count": "1",
				},
				body: JSON.stringify([
					{
						id: 1,
						name: "Machines",
						description: "Managed hosts",
						collection,
						json_schema: {},
						validate_schema: false,
						created_at: timestamp,
						updated_at: timestamp,
					},
				]),
			});
		});
		await page.route("**/api/v1/collections?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([collection]),
			});
		});
		await page.setViewportSize({ width: 1440, height: 900 });
		const toolsShareOneRow = (
			selector: string,
			inputLabel: string,
			searchLabel: string,
		) =>
			page.locator(selector).evaluate(
				(element, labels) => {
					const input = element.querySelector<HTMLElement>(
						`input[aria-label="${labels.input}"]`,
					);
					const search = element.querySelector<HTMLElement>(
						`button[aria-label="${labels.search}"]`,
					);
					const download = element.querySelector<HTMLElement>(
						".table-export-trigger",
					);
					if (!input || !search || !download) {
						return false;
					}
					const inputBounds = input.getBoundingClientRect();
					const searchBounds = search.getBoundingClientRect();
					const downloadBounds = download.getBoundingClientRect();
					const centerY = (bounds: DOMRect) =>
						bounds.top + bounds.height / 2;
					return (
						getComputedStyle(element).display === "grid" &&
						downloadBounds.right <= inputBounds.left &&
						inputBounds.right <= searchBounds.left &&
						Math.abs(centerY(downloadBounds) - centerY(inputBounds)) <= 1 &&
						Math.abs(centerY(inputBounds) - centerY(searchBounds)) <= 1
					);
				},
				{ input: inputLabel, search: searchLabel },
			);

		await page.goto("/collections");
		const collectionTools = page.locator(".collections-table-tools");
		await expect(
			collectionTools.getByRole("button", { name: "Download" }),
		).toBeVisible();
		expect(
			await toolsShareOneRow(
				".collections-table-tools",
				"Filter loaded collections",
				"Filter collections",
			),
		).toBe(true);

		await page.evaluate(() =>
			window.localStorage.removeItem("hubuum.table.classes.widths"),
		);
		await page.goto("/classes");

		const tableTools = page.locator(".classes-table-tools");
		await expect(
			tableTools.getByRole("button", { name: "Download" }),
		).toBeVisible();
		expect(
			await toolsShareOneRow(
				".classes-table-tools",
				"Filter loaded classes",
				"Filter classes",
			),
		).toBe(true);

		const table = page.locator("#classes-table");
		const headers = table.locator("thead th");
		const headerRow = table.locator("thead tr");
		const selectAll = table.getByLabel("Select all classes");
		const resizeHandle = headers.nth(2).locator(".resize-handle");
		const lastResizeHandle = headers.last().locator(".resize-handle");
		await expect(headers).toHaveCount(5);
		await expect(resizeHandle).toBeVisible();
		await expect(lastResizeHandle).toBeVisible();
		const [headerRowBounds, selectAllBounds] = await Promise.all([
			headerRow.boundingBox(),
			selectAll.boundingBox(),
		]);
		expect(headerRowBounds).not.toBeNull();
		expect(selectAllBounds).not.toBeNull();
		expect(
			headerRowBounds?.height ?? Number.POSITIVE_INFINITY,
		).toBeLessThanOrEqual(36);
		expect(
			Math.abs(
				((headerRowBounds?.y ?? 0) + (headerRowBounds?.height ?? 0) / 2) -
					((selectAllBounds?.y ?? 0) + (selectAllBounds?.height ?? 0) / 2),
			),
		).toBeLessThanOrEqual(1);

		const readGeometry = () =>
			headers.evaluateAll((elements) =>
				elements.map((element) => {
					const bounds = element.getBoundingClientRect();
					return {
						left: Math.round(bounds.left),
						width: Math.round(bounds.width),
					};
				}),
			);
		const before = await readGeometry();
		const handleBounds = await resizeHandle.boundingBox();
		expect(handleBounds).not.toBeNull();

		const dragDistance = 64;
		const dragStartX = (handleBounds?.x ?? 0) + (handleBounds?.width ?? 0) / 2;
		const dragY = (handleBounds?.y ?? 0) + (handleBounds?.height ?? 0) / 2;
		await page.mouse.move(dragStartX, dragY);
		await page.mouse.down();
		await page.mouse.move(dragStartX + dragDistance, dragY, { steps: 4 });
		await page.mouse.up();

		const after = await readGeometry();
		expect(before[0]?.width).toBeLessThanOrEqual(36);
		expect(after[0]).toEqual(before[0]);
		expect(after[1]).toEqual(before[1]);
		expect(after[2]?.left).toBe(before[2]?.left);
		expect(after[2]?.width).toBe((before[2]?.width ?? 0) + dragDistance);
		expect(after[3]?.left).toBe((before[3]?.left ?? 0) + dragDistance);
		expect(after[3]?.width).toBe(before[3]?.width);
		expect(after[4]?.left).toBe((before[4]?.left ?? 0) + dragDistance);
		expect(after[4]?.width).toBe(before[4]?.width);

		const lastHandleBounds = await lastResizeHandle.boundingBox();
		expect(lastHandleBounds).not.toBeNull();
		const lastDragDistance = -48;
		const lastDragStartX =
			(lastHandleBounds?.x ?? 0) + (lastHandleBounds?.width ?? 0) / 2;
		const lastDragY =
			(lastHandleBounds?.y ?? 0) + (lastHandleBounds?.height ?? 0) / 2;
		await page.mouse.move(lastDragStartX, lastDragY);
		await page.mouse.down();
		await page.mouse.move(lastDragStartX + lastDragDistance, lastDragY, {
			steps: 3,
		});
		await page.mouse.up();

		const afterLastResize = await readGeometry();
		expect(afterLastResize.slice(0, 4)).toEqual(after.slice(0, 4));
		expect(afterLastResize[4]?.left).toBe(after[4]?.left);
		expect(afterLastResize[4]?.width).toBe(
			(after[4]?.width ?? 0) + lastDragDistance,
		);
	});

	test("resource counts share the contextual heading with create", async ({
		page,
	}) => {
		const timestamp = "2026-07-29T12:00:00Z";
		let objectRequestCount = 0;
		await page.route("**/api/v1/classes?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([
					{
						id: 1,
						name: "Math",
						description: "",
						collection: {
							id: 1,
							name: "Root",
							description: "",
							parent_collection_id: null,
							created_at: timestamp,
							updated_at: timestamp,
						},
						json_schema: {},
						validate_schema: false,
						created_at: timestamp,
						updated_at: timestamp,
					},
				]),
			});
		});
		await page.route("**/_hubuum-bff/classes/1/objects?**", async (route) => {
			objectRequestCount += 1;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: {
					"X-Total-Count": "9",
				},
				body: JSON.stringify(
					["Euler", "Noether"].map((name, index) => ({
						id: index + 1,
						name,
						description: "",
						collection_id: 1,
						hubuum_class_id: 1,
						data: {},
						computed: {
							shared: {
								errors: {},
								materialization_stale: false,
								revision: 1,
								values: {},
							},
						},
						created_at: timestamp,
						updated_at: timestamp,
					})),
				),
			});
		});

		await page.goto("/objects?classId=1");

		const card = page.locator(".objects-resource-index");
		const heading = card.locator(".resource-index-heading");
		const summary = heading.locator(".resource-index-summary");
		const create = heading.getByRole("button", { name: "New Math" });
		await expect(
			heading.getByRole("heading", { name: "Objects" }),
		).toBeVisible();
		await expect(
			heading.getByRole("combobox", { name: "Objects class context" }),
		).toHaveValue("1");
		await expect(summary).toContainText("2/9");
		await expect(create).toBeVisible();
		await expect(page.locator(".fab--create")).toBeHidden();
		await expect(page.locator(".topbar .topbar-left")).toHaveCount(0);
		await expect(
			page
				.locator(".topbar")
				.getByRole("combobox", { name: "Objects class context" }),
		).toHaveCount(0);

		const exportSearchTools = card.locator(".object-export-search-tools");
		await expect(exportSearchTools).toBeVisible();
		expect(
			await exportSearchTools.evaluate((element) => {
				const exportButton = element.querySelector<HTMLElement>(
					".table-export-trigger",
				);
				const searchInput = element.querySelector<HTMLElement>(
					".table-filter-input",
				);
				const searchButton = element.querySelector<HTMLElement>(
					'button[aria-label="Find objects on this page"]',
				);
				if (!exportButton || !searchInput || !searchButton) {
					return false;
				}
				const exportBounds = exportButton.getBoundingClientRect();
				const inputBounds = searchInput.getBoundingClientRect();
				const buttonBounds = searchButton.getBoundingClientRect();
				const centerY = (bounds: DOMRect) => bounds.top + bounds.height / 2;
				return (
					getComputedStyle(element).flexWrap === "nowrap" &&
					exportBounds.right <= inputBounds.left &&
					Math.abs(centerY(exportBounds) - centerY(inputBounds)) <= 1 &&
					Math.abs(centerY(inputBounds) - centerY(buttonBounds)) <= 1
				);
			}),
		).toBe(true);

		const objectTable = page.locator("#objects-table");
		const selectHeader = objectTable.locator("thead th").first();
		const idHeader = objectTable.locator('thead th[data-column-key="id"]');
		const idResizeHandle = idHeader.locator(".resize-handle");
		const selectHeaderBounds = await selectHeader.boundingBox();
		const idResizeHandleBounds = await idResizeHandle.boundingBox();
		expect(
			selectHeaderBounds?.width ?? Number.POSITIVE_INFINITY,
		).toBeLessThanOrEqual(38);
		expect(idResizeHandleBounds).not.toBeNull();

		const requestCountBeforeResize = objectRequestCount;
		const sortBeforeResize = await idHeader.getAttribute("aria-sort");
		const resizeStartX =
			(idResizeHandleBounds?.x ?? 0) + (idResizeHandleBounds?.width ?? 0) / 2;
		const resizeY =
			(idResizeHandleBounds?.y ?? 0) + (idResizeHandleBounds?.height ?? 0) / 2;
		await page.mouse.move(resizeStartX, resizeY);
		await page.mouse.down();
		await page.mouse.move(resizeStartX + 40, resizeY, { steps: 3 });
		await page.mouse.up();
		await page.waitForTimeout(150);
		expect(await idHeader.getAttribute("aria-sort")).toBe(sortBeforeResize);
		expect(objectRequestCount).toBe(requestCountBeforeResize);

		expect(
			await heading.evaluate((element) => {
				const summaryElement = element.querySelector(".resource-index-summary");
				const createElement = element.querySelector(".create-button");
				return Boolean(
					summaryElement &&
						createElement &&
						summaryElement.compareDocumentPosition(createElement) &
							Node.DOCUMENT_POSITION_FOLLOWING,
				);
			}),
		).toBe(true);
	});

	test("Stillwater keeps navigation separate from object context", async ({
		page,
	}) => {
		const timestamp = "2026-07-29T12:00:00Z";
		await page.route("**/api/v1/classes?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([
					{
						id: 1,
						name: "Infrastructure machines with extended lifecycle metadata",
						description: "",
						collection: {
							id: 1,
							name: "Operations",
							description: "",
							parent_collection_id: null,
							created_at: timestamp,
							updated_at: timestamp,
						},
						json_schema: {},
						validate_schema: false,
						created_at: timestamp,
						updated_at: timestamp,
					},
				]),
			});
		});

		for (const width of [1440, 1100, 901]) {
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/objects?classId=1");

			const topbar = page.locator(".topbar");
			const navigation = topbar.locator(".topology-navigation--topbar");
			const resourceCard = page.locator(".objects-resource-index");
			const classSelect = resourceCard.getByRole("combobox", {
				name: "Objects class context",
			});
			await expect(navigation).toBeVisible();
			await expect(page.locator(".sidebar.card")).toBeHidden();
			await expect(resourceCard).toBeVisible();
			await expect(classSelect).toBeVisible();
			await expect(topbar.locator(".topbar-left")).toHaveCount(0);
			await expect(
				topbar.getByRole("combobox", { name: "Objects class context" }),
			).toHaveCount(0);

			const layout = await page.evaluate(() => {
				const topbarElement = document.querySelector<HTMLElement>(".topbar");
				const navigationElement = document.querySelector<HTMLElement>(
					".topology-navigation--topbar",
				);
				const identityElement = document.querySelector<HTMLElement>(
					".topology-topbar-identity",
				);
				const resourceCardElement = document.querySelector<HTMLElement>(
					".objects-resource-index",
				);
				const selectElement = document.querySelector<HTMLElement>(
					'[aria-label="Objects class context"]',
				);
				const utilitiesElement =
					document.querySelector<HTMLElement>(".topbar-right");
				const topbarBounds = topbarElement?.getBoundingClientRect();
				const navigationBounds = navigationElement?.getBoundingClientRect();
				const identityBounds = identityElement?.getBoundingClientRect();
				const resourceCardBounds = resourceCardElement?.getBoundingClientRect();
				const selectBounds = selectElement?.getBoundingClientRect();
				const utilitiesBounds = utilitiesElement?.getBoundingClientRect();
				return {
					bodyWidth: document.body.scrollWidth,
					identityBottom: identityBounds?.bottom ?? -1,
					navigationLeft: navigationBounds?.left ?? -1,
					navigationRight: navigationBounds?.right ?? Number.POSITIVE_INFINITY,
					navigationTop: navigationBounds?.top ?? -1,
					resourceCardLeft: resourceCardBounds?.left ?? -1,
					resourceCardRight:
						resourceCardBounds?.right ?? Number.POSITIVE_INFINITY,
					selectLeft: selectBounds?.left ?? -1,
					selectRight: selectBounds?.right ?? Number.POSITIVE_INFINITY,
					topbarLeft: topbarBounds?.left ?? -1,
					topbarRight: topbarBounds?.right ?? Number.POSITIVE_INFINITY,
					utilitiesRight: utilitiesBounds?.right ?? Number.POSITIVE_INFINITY,
					viewportWidth: window.innerWidth,
				};
			});

			expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
			expect(layout.navigationLeft).toBeGreaterThanOrEqual(layout.topbarLeft);
			expect(layout.navigationRight).toBeLessThanOrEqual(layout.topbarRight);
			expect(layout.utilitiesRight).toBeLessThanOrEqual(layout.topbarRight);
			expect(layout.selectLeft).toBeGreaterThanOrEqual(layout.resourceCardLeft);
			expect(layout.selectRight).toBeLessThanOrEqual(layout.resourceCardRight);
			if (width <= 1120) {
				expect(layout.navigationTop).toBeGreaterThanOrEqual(
					layout.identityBottom - 1,
				);
			}
		}

		const topNavigation = page.locator(".topology-navigation--topbar");
		const dataMenu = topNavigation.getByRole("button", { name: "Data" });
		const workflowsMenu = topNavigation.getByRole("button", {
			name: "Workflows",
		});
		await dataMenu.click();
		await expect(dataMenu).toHaveAttribute("aria-expanded", "true");
		await expect(
			page
				.locator(".topology-navigation--topbar")
				.getByRole("link", { name: /Classes:/ }),
		).toBeVisible();

		await workflowsMenu.click();
		await expect(dataMenu).toHaveAttribute("aria-expanded", "false");
		await expect(workflowsMenu).toHaveAttribute("aria-expanded", "true");

		await page.locator("#main-content").click({ position: { x: 2, y: 2 } });
		await expect(workflowsMenu).toHaveAttribute("aria-expanded", "false");

		await page.setViewportSize({ width: 768, height: 900 });
		await page.reload();
		await expect(
			page.locator(".topbar .topology-navigation--topbar"),
		).toBeHidden();
		const openNavigation = page.getByRole("button", {
			name: "Open navigation",
		});
		await openNavigation.click();
		await expect(page.locator(".sidebar.card")).toBeInViewport();
	});

	test("Stillwater atmosphere visibly tints navigation and ambient detail", async ({
		page,
	}) => {
		await page.goto("/account/appearance");
		const atmosphere = page.getByRole("group", { name: "Atmosphere" });
		const selectedLabel =
			(
				await atmosphere
					.locator('button[aria-pressed="true"] strong')
					.textContent()
			)?.trim() ?? "Sunset";
		const targetLabel = selectedLabel === "Clouds" ? "Golden Hour" : "Clouds";
		const targetAtmosphere =
			targetLabel === "Clouds" ? "clouds" : "golden-hour";

		const readAtmosphere = () =>
			page.evaluate(() => {
				const rootStyle = getComputedStyle(document.documentElement);
				const topbar = document.querySelector<HTMLElement>(".topbar");
				return {
					accent: rootStyle.getPropertyValue("--accent").trim(),
					background: rootStyle.getPropertyValue("--bg").trim(),
					haze: rootStyle.getPropertyValue("--stillwater-haze").trim(),
					ink: rootStyle.getPropertyValue("--ink").trim(),
					secondary: rootStyle.getPropertyValue("--secondary-accent").trim(),
					topbarBackground: topbar
						? getComputedStyle(topbar).backgroundImage
						: "",
				};
			});
		const before = await readAtmosphere();

		try {
			await atmosphere
				.getByRole("button", { name: targetLabel })
				.click();
			await expect(page.locator("html")).toHaveAttribute(
				"data-atmosphere",
				targetAtmosphere,
			);

			const after = await readAtmosphere();
			expect(after.accent).not.toBe(before.accent);
			expect(after.background).not.toBe(before.background);
			expect(after.ink).not.toBe(before.ink);
			expect(after.secondary).not.toBe(before.secondary);
			expect(after.haze).not.toBe(before.haze);
			expect(after.topbarBackground).not.toBe(before.topbarBackground);
		} finally {
			await atmosphere
				.getByRole("button", { name: selectedLabel })
				.click();
		}
	});

	test("imports starts with a gated file-first workflow", async ({ page }) => {
		await page.goto("/imports");

		const fileTab = page.getByRole("tab", { name: /1\. File/ });
		const destinationTab = page.getByRole("tab", { name: /2\. Destination/ });
		const policiesTab = page.getByRole("tab", { name: /3\. Policies/ });
		const reviewTab = page.getByRole("tab", { name: /4\. Review/ });

		await expect(fileTab).toHaveAttribute("aria-selected", "true");
		await expect(destinationTab).toBeDisabled();
		await expect(policiesTab).toBeDisabled();
		await expect(reviewTab).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Choose file" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Continue to destination" }),
		).toBeDisabled();
	});

	test("token expiry shows the effective server default lifetime", async ({
		page,
	}) => {
		await page.route("**/_hubuum-bff/hubuum/api/v1/config", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					authentication: {
						default_token_lifetime_hours: 36,
					},
					pagination: {
						default_page_limit: 50,
						max_page_limit: 250,
					},
				}),
			});
		});
		await page.goto("/account/tokens");
		await page.getByRole("button", { name: "Create new" }).click();

		await expect(
			page.getByText(
				"Leave blank to use the server default lifetime of 36 hours.",
				{ exact: true },
			),
		).toBeVisible();
	});

	test("exports separates running, templates, and history into task views", async ({
		page,
	}) => {
		await page.route("**/api/v1/export-templates**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: "[]",
			});
		});
		await page.goto("/exports");

		const runTab = page.getByRole("tab", { name: /Reports/ });
		const oneOffTab = page.getByRole("tab", { name: /One-off/ });
		const templatesTab = page.getByRole("tab", { name: /Templates/ });
		const historyTab = page.getByRole("tab", { name: /History/ });

		await expect(runTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Saved reports" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /(?:New|Create).*template/i }),
		).toHaveCount(0);

		await oneOffTab.click();
		await expect(oneOffTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "One-off JSON export" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Run export" }),
		).toBeVisible();

		await templatesTab.click();
		const createTemplate = page.getByRole("button", {
			name: "Create new template",
		});
		await createTemplate.click();
		await expect(page).toHaveURL(/\/exports\/templates\/new$/);
		await expect(
			page.getByRole("heading", { name: "Create export template" }),
		).toBeVisible();
		const detailsTab = page.getByRole("tab", { name: /1\. Details/ });
		const targetTab = page.getByRole("tab", { name: /2\. Target/ });
		const filtersTab = page.getByRole("tab", { name: /3\. Query/ });
		const relatedTab = page.getByRole("tab", { name: /4\. Related/ });
		const rulesTab = page.getByRole("tab", { name: /5\. Rules/ });
		const appearanceTab = page.getByRole("tab", { name: /6\. Design/ });
		const templateHistoryTab = page.getByRole("tab", { name: /History/ });
		await expect(detailsTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Template details" }),
		).toBeVisible();
		await expect(targetTab).toBeDisabled();
		await expect(appearanceTab).toBeDisabled();
		await expect(templateHistoryTab).toBeDisabled();
		await page
			.getByRole("textbox", { name: "Name", exact: true })
			.fill("Weekly inventory");
		await page
			.getByLabel("Description")
			.fill("The current inventory for operations.");
		await page
			.getByRole("button", { name: "Continue to target" })
			.first()
			.click();
		await expect(targetTab).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("combobox", { name: "Scope", exact: true })
			.selectOption("collections");
		await expect(appearanceTab).toBeEnabled();
		await page
			.getByRole("button", { name: "Continue to query" })
			.first()
			.click();
		await expect(filtersTab).toHaveAttribute("aria-selected", "true");
		await page.getByRole("button", { name: "Add filter" }).click();
		await expect(page.getByText("Filter 1", { exact: true })).toBeVisible();
		await page
			.getByRole("button", { name: "Continue to related" })
			.first()
			.click();
		await expect(relatedTab).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("button", { name: "Continue to rules" })
			.first()
			.click();
		await expect(rulesTab).toHaveAttribute("aria-selected", "true");
		await page
			.getByRole("button", { name: "Continue to design" })
			.first()
			.click();
		await expect(appearanceTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Test output" }),
		).toBeVisible();
		let discardPrompt = "";
		page.once("dialog", async (dialog) => {
			discardPrompt = dialog.message();
			await dialog.accept();
		});
		await page.getByRole("button", { name: "Back to templates" }).click();
		expect(discardPrompt).toBe("Discard the changes to this export template?");
		await expect(page).toHaveURL(/\/exports\?view=templates$/);
		await expect(templatesTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Template library" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create new template" }),
		).toBeVisible();

		await historyTab.click();
		await expect(historyTab).toHaveAttribute("aria-selected", "true");
		await expect(
			page.getByRole("heading", { name: "Recent export runs" }),
		).toBeVisible();
	});

	test("exposes raw task and bookmarkable template report links", async ({
		context,
		page,
	}) => {
		const timestamp = "2026-07-26T08:00:00Z";
		let template = {
			id: 7,
			collection_id: 1,
			name: "Inventory",
			description: "Current server inventory",
			content_type: "text/plain",
			template: "{% for item in items %}{{ item.name }}{% endfor %}",
			kind: "export",
			scope_kind: "objects_in_class",
			class_id: 10,
			default_query:
				"name__icontains=server&updated_at__gte=2026-01-01&sort=updated_at.desc",
			include: null,
			relation_context: null,
			default_missing_data_policy: "strict",
			default_limits: null,
			created_at: timestamp,
			updated_at: timestamp,
		};
		const submittedDefaultQueryPatches: Array<{ default_query: string }> = [];
		const task = {
			id: 314,
			kind: "export",
			status: "succeeded",
			created_at: timestamp,
			started_at: timestamp,
			finished_at: timestamp,
			submitted_by: null,
			summary: "Rendered inventory",
			request_redacted_at: null,
			progress: {
				total_items: 2,
				processed_items: 2,
				success_items: 2,
				failed_items: 0,
			},
			links: {
				task: "/api/v1/tasks/314",
				events: "/api/v1/tasks/314/events",
				export: "/api/v1/exports/314",
				export_output: "/api/v1/exports/314/output",
			},
			details: {
				export: {
					output_available: true,
					output_expired: false,
					output_expires_at: "2026-07-27T08:00:00Z",
					output_content_type: "text/plain",
					output_url: "/api/v1/exports/314/output",
					template_name: "Inventory",
					truncated: false,
					warning_count: 0,
				},
			},
		};

		await context.route("**/api/v1/classes?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([
					{
						id: 10,
						name: "Machines",
						collection: {
							id: 1,
							name: "Root",
							description: "",
							parent_collection_id: null,
							created_at: timestamp,
							updated_at: timestamp,
						},
					},
				]),
			});
		});
		await context.route("**/api/v1/export-templates**", async (route) => {
			const pathname = new URL(route.request().url()).pathname;
			if (route.request().method() === "PATCH") {
				const submittedDefaultQueryPatch = route.request().postDataJSON() as {
					default_query: string;
				};
				submittedDefaultQueryPatches.push(submittedDefaultQueryPatch);
				template = {
					...template,
					...submittedDefaultQueryPatch,
					updated_at: "2026-07-26T08:05:00Z",
				};
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(template),
				});
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(
					pathname.endsWith(`/${template.id}`) ? template : [template],
				),
			});
		});
		await context.route(
			"**/_hubuum-bff/classes/10/objects?**",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: "[]",
				});
			},
		);
		await context.route(
			"**/api/v1/classes/10/computed-fields**",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({ definitions: [] }),
				});
			},
		);
		await context.route("**/api/v1/iam/me/computed-fields**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: "[]",
			});
		});
		await context.route("**/reports/7**", async (route) => {
			if (new URL(route.request().url()).pathname !== "/reports/7") {
				await route.fallback();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: "text/plain",
				body: "Configured inventory report",
			});
		});
		await context.route("**/api/v1/tasks?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([task]),
			});
		});
		await context.route("**/_hubuum-bff/reports/latest", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					results: [
						{
							generatedAt: task.finished_at,
							outputExpiresAt: task.details.export.output_expires_at,
							state: "available",
							taskId: task.id,
							templateId: template.id,
						},
					],
				}),
			});
		});
		await page.goto("/exports?view=history");
		const taskRow = page.getByRole("row").filter({ hasText: "Export #314" });
		const openResult = taskRow.getByRole("link", {
			name: "Open in new tab",
		});
		await expect(openResult).toHaveAttribute("target", "_blank");
		await expect(openResult).toHaveAttribute("rel", "noopener noreferrer");
		await expect(openResult).toHaveAttribute("href", "/reports/runs/314");

		await page.getByRole("tab", { name: /Reports/ }).click();
		const configureReport = page.getByRole("link", {
			name: "Run with changes",
		});
		await expect(configureReport).toHaveAttribute("href", "/exports/reports/7");
		const openReport = page.getByRole("link", { name: "View", exact: true });
		await expect(openReport).toHaveAttribute("href", "/reports/7");
		await expect(openReport).toHaveAttribute("target", "_blank");
		await expect(openReport).toHaveAttribute(
			"data-action-hint",
			/Open the latest acceptable result/,
		);
		await expect(
			page.getByRole("link", { name: "Refresh now" }),
		).toHaveAttribute("href", "/reports/7/refresh");
		const latestExport = page.getByText(/Latest export:/);
		await expect(latestExport).toBeVisible();
		await expect(latestExport).toHaveAttribute(
			"data-action-hint",
			/Stored output is available until/,
		);
		await expect(page.getByText("Class: Machines (#10)")).toBeVisible();
		const savedQuery = page.getByText(/Saved query/);
		await expect(savedQuery).toHaveAttribute(
			"data-action-hint",
			/Filters — Name contains, ignoring case “server”; Updated At greater than or equal to “2026-01-01”\. Sort — Updated At descending\./,
		);
		await expect(savedQuery).not.toHaveAttribute(
			"data-action-hint",
			/__|&|%3D/,
		);
		await expect(page.getByText(/Template:/)).toBeVisible();
		const reportCard = page.locator(".report-card").filter({
			has: page.getByRole("heading", { name: "Inventory" }),
		});
		await reportCard.getByText("More", { exact: true }).click();
		await reportCard
			.getByRole("button", { name: "Edit default query" })
			.click();
		const defaultQueryDialog = page.getByRole("dialog", {
			name: "Edit default query · Inventory",
		});
		await expect(defaultQueryDialog).toBeVisible();
		const serverFiltersButton = defaultQueryDialog.getByRole("button", {
			name: /Server filters/,
		});
		await serverFiltersButton.click();
		const serverFiltersDialog = defaultQueryDialog.getByRole("dialog", {
			name: "Server filters",
		});
		await expect(serverFiltersDialog).toBeVisible();
		const serverFilterField = serverFiltersDialog.getByLabel(
			"Server filter field",
		);
		await expect(
			serverFilterField.locator('option[value="created_at"]'),
		).toHaveText("Created at");
		await expect(
			serverFilterField.locator('option[value="updated_at"]'),
		).toHaveText("Updated at");
		await serverFilterField.selectOption("created_at");
		await expect(
			serverFiltersDialog.getByLabel("Server filter operator"),
		).toContainText("is on or after");
		const [defaultQueryDialogBox, serverFiltersDialogBox] = await Promise.all([
			defaultQueryDialog.boundingBox(),
			serverFiltersDialog.boundingBox(),
		]);
		expect(defaultQueryDialogBox).not.toBeNull();
		expect(serverFiltersDialogBox).not.toBeNull();
		expect(serverFiltersDialogBox?.x).toBeGreaterThanOrEqual(
			defaultQueryDialogBox?.x ?? 0,
		);
		expect(
			(serverFiltersDialogBox?.x ?? 0) + (serverFiltersDialogBox?.width ?? 0),
		).toBeLessThanOrEqual(
			(defaultQueryDialogBox?.x ?? 0) + (defaultQueryDialogBox?.width ?? 0),
		);
		await serverFiltersButton.click();
		await expect(serverFiltersDialog).toBeHidden();
		await defaultQueryDialog
			.getByText("Advanced query parameters", { exact: true })
			.click();
		await defaultQueryDialog
			.getByRole("textbox", { name: "Parameters" })
			.fill("visibility=internal");
		await defaultQueryDialog
			.getByRole("button", { name: "Save default query" })
			.click();
		await expect(defaultQueryDialog).toBeHidden();
		expect(submittedDefaultQueryPatches).toHaveLength(1);
		expect(Object.keys(submittedDefaultQueryPatches[0] ?? {})).toEqual([
			"default_query",
		]);
		expect(submittedDefaultQueryPatches[0]?.default_query).toContain(
			"visibility=internal",
		);
		await expect(
			page.getByText("Default query for “Inventory” saved."),
		).toBeVisible();

		await configureReport.click();
		await expect(page).toHaveURL(/\/exports\/reports\/7$/);
		await expect(
			page.getByRole("heading", { name: "Open the report as designed" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "View report" }),
		).toHaveAttribute("href", "/reports/7");
		await page.getByText("Change it for this view", { exact: true }).click();
		const customizedFilters = page.getByRole("button", {
			name: /^Server filters/,
		});
		await customizedFilters.click();
		const customizedFiltersDialog = page.getByRole("dialog", {
			name: "Server filters",
		});
		await customizedFiltersDialog
			.getByLabel("Server filter field")
			.selectOption("description");
		await customizedFiltersDialog
			.getByLabel("Server filter value")
			.fill("server");
		await customizedFiltersDialog
			.getByRole("button", { name: "Add filter" })
			.click();
		await expect(customizedFilters).toContainText("3");
		await customizedFilters.click();
		await expect(customizedFiltersDialog).toBeHidden();
		const viewWithChanges = page.getByRole("button", {
			name: "View with changes",
		});
		const refreshWithChanges = page.getByRole("button", {
			name: "Refresh now",
		});
		const copyCustomizedLink = page.getByRole("button", {
			name: "Copy customized link",
		});
		await expect(viewWithChanges).toHaveAttribute(
			"data-action-hint",
			/Open this customized report/,
		);
		await expect(refreshWithChanges).toHaveAttribute(
			"data-action-hint",
			/Generate one fresh customized result/,
		);
		await expect(copyCustomizedLink).toHaveAttribute(
			"data-action-hint",
			/Copy a bookmarkable report URL/,
		);
		await viewWithChanges.hover();
		await expect
			.poll(() =>
				viewWithChanges.evaluate(
					(element) => getComputedStyle(element, "::after").visibility,
				),
			)
			.toBe("visible");
		const duplicateTemplate = page.getByRole("link", { name: "Duplicate" });
		await expect(duplicateTemplate).toHaveAttribute(
			"href",
			"/exports/templates/new?from=7",
		);
		await duplicateTemplate.click();
		await expect(page).toHaveURL(/\/exports\/templates\/new\?from=7$/);
		await expect(
			page.getByRole("heading", { name: "Duplicate Inventory" }),
		).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: "Name", exact: true }),
		).toHaveValue("Inventory copy");
	});

	test("selecting a related class infers its minimum include depth", async ({
		page,
	}) => {
		const timestamp = "2026-07-26T00:00:00Z";
		const collection = {
			id: 7,
			name: "Infrastructure",
			description: "",
			parent_collection_id: null,
			created_at: timestamp,
			updated_at: timestamp,
		};
		const classes = [
			{
				id: 10,
				name: "Hosts",
				description: "",
				collection,
				json_schema: {},
				validate_schema: false,
				created_at: timestamp,
				updated_at: timestamp,
			},
			{
				id: 20,
				name: "Jacks",
				description: "",
				collection,
				json_schema: {},
				validate_schema: false,
				created_at: timestamp,
				updated_at: timestamp,
			},
			{
				id: 30,
				name: "Rooms",
				description: "",
				collection,
				json_schema: {},
				validate_schema: false,
				created_at: timestamp,
				updated_at: timestamp,
			},
		];
		const template = {
			id: 2,
			collection_id: collection.id,
			name: "Hosts with rooms",
			description: "Hydrates rooms for every host",
			content_type: "text/plain",
			template: "{% for item in items %}{{ item.name }}{% endfor %}",
			kind: "export",
			scope_kind: "objects_in_class",
			class_id: 10,
			default_query: null,
			include: null,
			relation_context: null,
			default_missing_data_policy: "strict",
			default_limits: null,
			created_at: timestamp,
			updated_at: timestamp,
		};

		await page.route("**/api/v1/export-templates**", async (route) => {
			const pathname = new URL(route.request().url()).pathname;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(
					pathname.endsWith("/api/v1/export-templates/2")
						? template
						: [template],
				),
			});
		});
		await page.route("**/api/v1/collections?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify([collection]),
			});
		});
		await page.route("**/api/v1/classes?**", async (route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify(classes),
			});
		});
		await page.route(
			"**/api/v1/classes/10/related/classes?**",
			async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify([
						{ ...classes[1], collection_id: collection.id, path: [10, 20] },
						{
							...classes[2],
							collection_id: collection.id,
							path: [10, 20, 30],
						},
					]),
				});
			},
		);

		await page.goto("/exports/templates/2");
		await page.getByRole("tab", { name: /4\. Related/ }).click();
		await page.getByRole("button", { name: "Add include" }).click();

		const relatedClass = page.getByLabel("Related class");
		const maximumDepth = page.getByLabel("Maximum path depth");
		await relatedClass.selectOption("30");

		await expect(maximumDepth).toHaveValue("2");
		await expect(maximumDepth).toHaveAttribute("min", "2");
		await expect(
			page.getByText(/This class is 2 relations away/),
		).toBeVisible();

		await maximumDepth.fill("3");
		await relatedClass.selectOption("20");
		await relatedClass.selectOption("30");
		await expect(maximumDepth).toHaveValue("3");

		await maximumDepth.fill("");
		await expect(maximumDepth).toHaveValue("2");
	});
});
