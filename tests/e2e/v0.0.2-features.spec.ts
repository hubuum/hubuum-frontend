import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Request, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";
const bffPrefix = "/_hubuum-bff/hubuum";

async function signIn(page: Page) {
	await page.goto("/login");
	const provider = page.locator("#identity-scope");
	await expect(
		page.getByRole("form", { name: "Login form" }),
	).not.toHaveAttribute("data-provider-discovery", "loading");
	const providerSelect = page.locator("select#identity-scope");
	if (await providerSelect.isVisible()) {
		await providerSelect.selectOption(identityScope);
	} else if ((await provider.getAttribute("type")) !== "hidden") {
		await provider.fill(identityScope);
	}
	await page.getByLabel("Username").fill(username ?? "");
	await page.getByLabel("Password").fill(password ?? "");
	await page.getByRole("button", { name: "Enter workspace" }).click();
	await page.waitForURL("**/app");
}

async function createComputedFieldThroughFlow(
	page: Page,
	scope: "shared" | "personal",
	label: string,
	key: string,
	previewObject: { id: number; name: string },
	checkAccessibility = false,
) {
	const scopeCard = page.getByRole("article").filter({
		has: page.getByRole("heading", {
			name: scope === "shared" ? "Shared fields" : "Personal fields",
		}),
	});
	await scopeCard.getByRole("button", { name: "New field" }).click();
	const editor = page.getByRole("article").filter({
		has: page.getByRole("heading", {
			name: `New ${scope} computed field`,
		}),
	});
	await expect(editor.getByRole("tab", { name: /Target/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await editor.getByRole("button", { name: "Continue to inputs" }).click();
	await editor
		.getByRole("button", { name: "Add hostname to selected inputs" })
		.click();
	await expect(
		editor.getByRole("button", { name: "Add hostname to selected inputs" }),
	).toHaveCount(0);
	await editor
		.getByRole("button", { name: "Add port to selected inputs" })
		.click();
	await editor
		.getByRole("button", { name: "Remove /port from selected inputs" })
		.click();
	await expect(
		editor.getByRole("button", { name: "Add port to selected inputs" }),
	).toBeVisible();
	await editor
		.getByRole("button", { name: "Add port to selected inputs" })
		.click();
	const selectedInputs = editor.locator(".computed-selected-input-list > li");
	await expect(selectedInputs).toHaveCount(2);
	await editor.getByRole("button", { name: "Move /hostname down" }).click();
	await expect(selectedInputs.nth(0)).toContainText("port");
	await editor.getByRole("button", { name: "Move /hostname up" }).click();
	await expect(selectedInputs.nth(0)).toContainText("hostname");
	await editor.getByRole("button", { name: "Continue to calculation" }).click();
	await expect(
		editor.getByRole("radio", { name: /First non-null/ }),
	).toBeChecked();
	await editor.getByRole("button", { name: "Continue to details" }).click();
	await editor.getByLabel("Label").fill(label);
	await expect(editor.getByLabel("Key")).toHaveValue(key);
	await editor.getByRole("button", { name: "Continue to preview" }).click();
	await editor.getByLabel("Find objects").fill(previewObject.name);
	await editor
		.getByLabel("Object", { exact: true })
		.selectOption(String(previewObject.id));
	if (checkAccessibility) {
		const results = await new AxeBuilder({ page })
			.include("#computed-field-panel-preview")
			.analyze();
		expect(
			results.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			),
		).toEqual([]);
	}
	await editor.getByRole("button", { name: "Run preview" }).click();
	await expect(editor.locator("pre", { hasText: '"e2e-host"' })).toBeVisible();
	await editor.getByRole("button", { name: "Save field" }).click();
	await expect(scopeCard.getByText(key, { exact: true })).toBeVisible();
}

test.describe("v0.0.3 server features", () => {
	test.skip(
		!username || !password,
		"Set E2E_USERNAME and E2E_PASSWORD to run authenticated flows.",
	);

	test.beforeEach(async ({ page }) => signIn(page));

	test("admin configuration and backup pages are accessible and explicit", async ({
		page,
	}) => {
		await page.goto("/admin/configuration");
		await expect(
			page.getByRole("heading", { name: "Runtime configuration" }),
		).toBeVisible();
		await expect(
			page.getByText(/Read-only effective server settings/),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: /^(?:Backup & restore|Recovery & permissions)$/,
			}),
		).toBeVisible();

		await page.goto("/admin/backups");
		await expect(
			page.getByRole("heading", { name: "Backup & restore", level: 2 }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create backup" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Validate and stage" }),
		).toBeDisabled();
		await expect(page.getByText(/replaces every Hubuum record/)).toBeVisible();

		const results = await new AxeBuilder({ page }).analyze();
		expect(
			results.violations.filter((violation) =>
				["serious", "critical"].includes(violation.impact ?? ""),
			),
		).toEqual([]);
	});

	test("audit explorer enriches collections and stacks drill-down filters", async ({
		page,
	}) => {
		const suffix = globalThis.crypto.randomUUID();
		const collectionName = `e2e_audit_collection_${suffix}`;
		const serviceAccountName = `e2e_audit_actor_${suffix}`;
		let collectionId: number | null = null;
		let serviceAccountEtag: string | undefined;
		let serviceAccountId: number | null = null;

		try {
			const groupsResponse = await page.request.get(
				`${bffPrefix}/api/v1/iam/groups?limit=1&include_total=false`,
			);
			expect(groupsResponse.ok()).toBe(true);
			const groups = (await groupsResponse.json()) as Array<{ id: number }>;
			expect(groups.length).toBeGreaterThan(0);

			const collectionResponse = await page.request.post(
				`${bffPrefix}/api/v1/collections`,
				{
					data: {
						description: "Playwright audit drill-down coverage",
						group_id: groups[0].id,
						name: collectionName,
					},
					headers: { Origin: new URL(page.url()).origin },
				},
			);
			expect(collectionResponse.status()).toBe(201);
			const collection = (await collectionResponse.json()) as { id: number };
			collectionId = collection.id;

			const serviceAccountResponse = await page.request.post(
				`${bffPrefix}/api/v1/iam/service-accounts`,
				{
					data: {
						description: "Playwright audit actor lookup coverage",
						name: serviceAccountName,
						owner_group_id: groups[0].id,
					},
					headers: { Origin: new URL(page.url()).origin },
				},
			);
			expect(serviceAccountResponse.status()).toBe(201);
			const serviceAccount = (await serviceAccountResponse.json()) as {
				id: number;
			};
			serviceAccountId = serviceAccount.id;
			serviceAccountEtag = serviceAccountResponse.headers().etag;

			await page.goto("/audit");
			await expect(
				page
					.getByRole("combobox", { name: "Collection" })
					.locator(`option[value="${collection.id}"]`),
			).toContainText(collectionName);

			const filterCard = page.locator(".audit-filter-card");
			const resultsCard = page.locator(".audit-results-card");
			const filterHeightBeforeLookup = await filterCard.evaluate(
				(element) => element.getBoundingClientRect().height,
			);
			const resultsTopBeforeLookup = await resultsCard.evaluate(
				(element) => element.getBoundingClientRect().top,
			);
			await page
				.getByRole("combobox", { name: "Entity type" })
				.selectOption("collection");
			const entityLookupTrigger = page.getByRole("button", {
				name: "Find entity",
			});
			await expect(entityLookupTrigger).toBeEnabled();
			await entityLookupTrigger.click();
			const entityPopover = page.locator("#audit-entity-popover");
			await expect(entityPopover).toBeVisible();
			const entityLookup = entityPopover.getByRole("combobox", {
				name: "Name",
			});
			await expect(entityLookup).toBeFocused();
			expect(
				await filterCard.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBeCloseTo(filterHeightBeforeLookup, 1);
			expect(
				await resultsCard.evaluate(
					(element) => element.getBoundingClientRect().top,
				),
			).toBeCloseTo(resultsTopBeforeLookup, 1);
			const entityLookupRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith("/api/v1/search") &&
					url.searchParams.get("q") === collectionName &&
					url.searchParams.get("kinds") === "collection"
				);
			});
			await entityLookup.fill(collectionName);
			await entityLookupRequest;
			const entityResults = page.getByRole("listbox", {
				name: "Find entity search results",
			});
			await expect(entityResults).toBeVisible();
			await entityLookup.press("ArrowDown");
			await entityLookup.press("Enter");
			await expect(entityResults).toBeHidden();
			await expect(
				page.getByRole("spinbutton", { name: "Entity ID" }),
			).toHaveValue(String(collection.id));

			await page
				.getByRole("combobox", { name: "Actor kind" })
				.selectOption("user");
			const actorLookupTrigger = page.getByRole("button", {
				name: "Find actor",
			});
			await expect(actorLookupTrigger).toBeEnabled();
			await actorLookupTrigger.click();
			const actorPopover = page.locator("#audit-actor-popover");
			const actorLookup = actorPopover.getByRole("combobox", { name: "Name" });
			await expect(actorLookup).toBeFocused();
			const userLookupRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith("/api/v1/iam/users") &&
					url.searchParams.get("name__icontains") === (username ?? "admin")
				);
			});
			await actorLookup.fill(username ?? "admin");
			await userLookupRequest;
			const actorResults = page.getByRole("listbox", {
				name: "Actor search results",
			});
			await expect(actorResults).toBeVisible();
			await actorLookup.press("ArrowDown");
			const activeActorOption = actorResults
				.getByRole("option")
				.filter({ hasText: username ?? "admin" })
				.first();
			await expect(activeActorOption).toHaveAttribute("aria-selected", "true");
			const activeActorColors = await activeActorOption.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					background: style.backgroundColor,
					foreground: style.color,
				};
			});
			expect(activeActorColors.background).not.toBe("rgba(0, 0, 0, 0)");
			expect(activeActorColors.background).not.toBe(
				activeActorColors.foreground,
			);
			const lookupAccessibility = await new AxeBuilder({ page })
				.include(".audit-filter-card")
				.analyze();
			expect(
				lookupAccessibility.violations.filter((violation) =>
					["serious", "critical"].includes(violation.impact ?? ""),
				),
			).toEqual([]);
			await actorLookup.press("Enter");
			await expect(actorResults).toBeHidden();
			await expect(actorLookupTrigger).toBeFocused();
			await expect(
				page.getByRole("spinbutton", { name: "Actor ID" }),
			).toHaveValue(/\d+/);

			await page
				.getByRole("combobox", { name: "Actor kind" })
				.selectOption("service_account");
			await actorLookupTrigger.click();
			const serviceAccountLookupRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith("/api/v1/iam/service-accounts") &&
					url.searchParams.get("name__icontains") === serviceAccountName
				);
			});
			await actorLookup.fill(serviceAccountName);
			await serviceAccountLookupRequest;
			await actorResults
				.getByRole("option")
				.filter({ hasText: serviceAccountName })
				.first()
				.click();
			await expect(
				page.getByRole("spinbutton", { name: "Actor ID" }),
			).toHaveValue(String(serviceAccount.id));

			const initiatorLookupTrigger = page.getByRole("button", {
				name: "Find initiator",
			});
			await initiatorLookupTrigger.click();
			const initiatorLookup = page
				.locator("#audit-initiator-popover")
				.getByRole("combobox", { name: "Name" });
			const initiatorUserRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith("/api/v1/iam/users") &&
					url.searchParams.get("name__icontains") === (username ?? "admin")
				);
			});
			const initiatorServiceAccountRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith("/api/v1/iam/service-accounts") &&
					url.searchParams.get("name__icontains") === (username ?? "admin")
				);
			});
			await initiatorLookup.fill(username ?? "admin");
			await Promise.all([initiatorUserRequest, initiatorServiceAccountRequest]);
			const initiatorResults = page.getByRole("listbox", {
				name: "Find initiator search results",
			});
			await expect(initiatorResults).toBeVisible();
			await initiatorResults
				.getByRole("option")
				.filter({ hasText: username ?? "admin" })
				.first()
				.click();
			await expect(initiatorResults).toBeHidden();
			await expect(
				page.getByRole("spinbutton", { name: "Initiator ID" }),
			).toHaveValue(/\d+/);

			let auditRow = page.locator("tbody tr").filter({
				hasText: collectionName,
			});
			await expect(auditRow).toHaveCount(1);
			const actionDrilldown = auditRow.getByRole("button", {
				name: /Drill down to action/,
			});
			const action = (await actionDrilldown.textContent())?.trim();
			if (!action) {
				throw new Error("Audit event action was not visible for drill-down.");
			}
			const actionColumnWidth = await page
				.locator(".audit-table-wrap")
				.getByRole("columnheader", { name: "Action" })
				.evaluate((element) => element.getBoundingClientRect().width);
			expect(actionColumnWidth).toBeGreaterThanOrEqual(144);
			const valueCellAlignments = await auditRow
				.locator("td.audit-value-cell")
				.evaluateAll((elements) =>
					elements.map((element) => getComputedStyle(element).verticalAlign),
				);
			expect(valueCellAlignments).toEqual([
				"middle",
				"middle",
				"middle",
				"middle",
				"middle",
			]);
			const actionDrilldownStyle = await actionDrilldown.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					marginLeft: style.marginLeft,
					paddingLeft: style.paddingLeft,
				};
			});
			expect(actionDrilldownStyle).toEqual({
				marginLeft: "0px",
				paddingLeft: "0px",
			});
			const actionDrilldownBox = await actionDrilldown.boundingBox();
			const actionCellBox = await actionDrilldown
				.locator("xpath=..")
				.boundingBox();
			expect(actionDrilldownBox).not.toBeNull();
			expect(actionCellBox).not.toBeNull();
			if (actionDrilldownBox && actionCellBox) {
				expect(
					actionDrilldownBox.x + actionDrilldownBox.width,
				).toBeLessThanOrEqual(actionCellBox.x + actionCellBox.width);
			}
			await page.evaluate(() => {
				document.documentElement.dataset.density = "compact";
			});
			const valueTextInsets = await auditRow.evaluate((row) => {
				function textInset(selector: string) {
					const element = row.querySelector(selector);
					const cell = element?.closest("td");
					const textNode = element
						? Array.from(element.childNodes).find(
								(node) =>
									node.nodeType === Node.TEXT_NODE &&
									Boolean(node.textContent?.trim()),
							)
						: undefined;
					if (!element || !cell || !textNode) {
						throw new Error(`Could not measure audit value ${selector}.`);
					}
					const range = document.createRange();
					range.selectNodeContents(textNode);
					return (
						range.getBoundingClientRect().left -
						cell.getBoundingClientRect().left
					);
				}

				return {
					action: textInset("td:nth-child(3) .audit-action-value"),
					filterable: textInset(
						"td:nth-child(4) .audit-drilldown-button",
					),
					plain: textInset("td:nth-child(5) .audit-static-value"),
				};
			});
			expect(valueTextInsets.plain).toBeCloseTo(
				valueTextInsets.filterable,
				1,
			);
			const headerTextInsets = await page
				.locator(".audit-table-wrap")
				.evaluate((table) =>
					Array.from(
						table.querySelectorAll("th.audit-value-header"),
					).map((header) => {
						const textNode = Array.from(header.childNodes).find(
							(node) =>
								node.nodeType === Node.TEXT_NODE &&
								Boolean(node.textContent?.trim()),
						);
						if (!textNode) {
							throw new Error("Could not measure audit header text.");
						}
						const range = document.createRange();
						range.selectNodeContents(textNode);
						return (
							range.getBoundingClientRect().left -
							header.getBoundingClientRect().left
						);
					}),
				);
			expect(headerTextInsets).toHaveLength(5);
			const expectedHeaderTextInsets = [
				valueTextInsets.filterable,
				valueTextInsets.action,
				valueTextInsets.filterable,
				valueTextInsets.filterable,
				valueTextInsets.filterable,
			];
			for (const [index, headerTextInset] of headerTextInsets.entries()) {
				expect(headerTextInset).toBeCloseTo(
					expectedHeaderTextInsets[index],
					1,
				);
			}
			await actionDrilldown.click();
			await expect(
				page.getByRole("button", {
					name: `Remove Action · ${action} filter`,
				}),
			).toBeVisible();
			await expect(page.getByText("1 active", { exact: true })).toBeVisible();

			auditRow = page.locator("tbody tr").filter({ hasText: collectionName });
			const collectionDrilldown = auditRow.getByRole("button", {
				name: /Drill down to collection/,
			});
			await expect(collectionDrilldown).toContainText(collectionName);
			await expect(collectionDrilldown).toHaveAttribute(
				"title",
				/Playwright audit drill-down coverage/,
			);
			await collectionDrilldown.click();
			await expect(
				page.getByRole("button", {
					name: new RegExp(`Remove Collection · .*#${collection.id}.* filter`),
				}),
			).toBeVisible();
			await expect(page.getByText("2 active", { exact: true })).toBeVisible();

			auditRow = page.locator("tbody tr").filter({ hasText: collectionName });
			await auditRow
				.getByRole("button", { name: /Drill down to actor/ })
				.click();
			await expect(
				page.getByRole("button", { name: /Remove Actor · .* filter/ }),
			).toBeVisible();
			await page.getByRole("button", { name: "Clear all" }).click();
			await expect(page.getByText("0 active", { exact: true })).toBeVisible();
		} finally {
			if (serviceAccountId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/iam/service-accounts/${serviceAccountId}`,
					{
						headers: {
							Origin: new URL(page.url()).origin,
							...(serviceAccountEtag ? { "If-Match": serviceAccountEtag } : {}),
						},
					},
				);
			}
			if (collectionId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/collections/${collectionId}`,
					{ headers: { Origin: new URL(page.url()).origin } },
				);
			}
		}
	});

	test("shared and personal computed fields appear on object reads", async ({
		page,
	}) => {
		const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
		const groupsResponse = await page.request.get(
			`${bffPrefix}/api/v1/iam/groups?limit=1&include_total=false`,
		);
		expect(groupsResponse.ok()).toBe(true);
		const groups = (await groupsResponse.json()) as Array<{ id: number }>;
		expect(groups.length).toBeGreaterThan(0);

		const collectionResponse = await page.request.post(
			`${bffPrefix}/api/v1/collections`,
			{
				data: {
					description: "Playwright computed-field coverage",
					group_id: groups[0].id,
					name: `e2e_computed_collection_${suffix}`,
				},
				headers: { Origin: new URL(page.url()).origin },
			},
		);
		expect(collectionResponse.status()).toBe(201);
		const collection = (await collectionResponse.json()) as { id: number };

		const classResponse = await page.request.post(
			`${bffPrefix}/api/v1/classes`,
			{
				data: {
					collection_id: collection.id,
					description: "Playwright computed-field coverage",
					json_schema: {
						properties: {
							hostname: { type: "string" },
							port: { type: "integer" },
						},
						type: "object",
					},
					name: `e2e_computed_class_${suffix}`,
					validate_schema: false,
				},
				headers: { Origin: new URL(page.url()).origin },
			},
		);
		expect(classResponse.status()).toBe(201);
		const hubuumClass = (await classResponse.json()) as { id: number };
		let objectId: number | null = null;
		let previewObjectId: number | null = null;

		try {
			const previewObjectName = `e2e_computed_preview_${suffix}`;
			const previewObjectResponse = await page.request.post(
				`/_hubuum-bff/classes/${hubuumClass.id}/objects`,
				{
					data: {
						collection_id: collection.id,
						data: {
							hostname: "e2e-host",
							network: { interfaces: [{ name: "eth0" }] },
							port: 443,
						},
						description: "Computed-field preview object",
						hubuum_class_id: hubuumClass.id,
						name: previewObjectName,
					},
					headers: { Origin: new URL(page.url()).origin },
				},
			);
			expect(previewObjectResponse.status()).toBe(201);
			const previewObject = (await previewObjectResponse.json()) as {
				id: number;
			};
			previewObjectId = previewObject.id;

			await page.goto(`/classes/${hubuumClass.id}#computed-fields`);
			await createComputedFieldThroughFlow(
				page,
				"shared",
				"Shared hostname",
				"shared_hostname",
				{ id: previewObject.id, name: previewObjectName },
				true,
			);
			await createComputedFieldThroughFlow(
				page,
				"personal",
				"Personal hostname",
				"personal_hostname",
				{ id: previewObject.id, name: previewObjectName },
			);

			const objectName = `e2e_computed_object_${suffix}`;
			const objectResponse = await page.request.post(
				`/_hubuum-bff/classes/${hubuumClass.id}/objects`,
				{
					data: {
						collection_id: collection.id,
						data: {
							hostname: "e2e-host",
							network: { interfaces: [{ name: "eth0" }] },
							port: 443,
						},
						description: "Computed-field object",
						hubuum_class_id: hubuumClass.id,
						name: objectName,
					},
					headers: { Origin: new URL(page.url()).origin },
				},
			);
			expect(objectResponse.status()).toBe(201);
			const object = (await objectResponse.json()) as { id: number };
			objectId = object.id;

			await page.goto(`/objects?classId=${hubuumClass.id}`);
			await expect(
				page.getByRole("columnheader", {
					name: /Shared computed field.*Shared hostname/i,
				}),
			).toBeVisible();
			await expect(
				page.getByRole("columnheader", {
					name: /Personal computed field.*Personal hostname/i,
				}),
			).toBeVisible();
			const computedMutationRequests: string[] = [];
			const recordComputedMutation = (request: Request) => {
				if (
					request.url().includes("/computed-fields") &&
					request.method() !== "GET"
				) {
					computedMutationRequests.push(`${request.method()} ${request.url()}`);
				}
			};
			page.on("request", recordComputedMutation);
			await page.getByRole("button", { name: "Columns" }).click();
			const columnPicker = page.getByRole("dialog", { name: "Object columns" });
			await expect(
				columnPicker.getByText("Data fields", { exact: true }),
			).toBeVisible();
			const sharedColumnToggle = columnPicker.getByRole("checkbox", {
				name: "Show shared computed field Shared hostname",
			});
			await sharedColumnToggle.uncheck();
			await expect(
				page.getByRole("columnheader", {
					name: /Shared computed field.*Shared hostname/i,
				}),
			).toHaveCount(0);
			await expect(
				page.getByRole("columnheader", {
					name: /Personal computed field.*Personal hostname/i,
				}),
			).toBeVisible();
			await sharedColumnToggle.check();
			await expect(
				page.getByRole("columnheader", {
					name: /Shared computed field.*Shared hostname/i,
				}),
			).toBeVisible();
			expect(computedMutationRequests).toEqual([]);
			page.off("request", recordComputedMutation);
			const limitedObjectRequest = page.waitForRequest((request) => {
				const url = new URL(request.url());
				return (
					url.pathname.endsWith(`/classes/${hubuumClass.id}/objects`) &&
					url.searchParams.get("limit") === "250"
				);
			});
			await page
				.getByRole("group", { name: "Fetch" })
				.getByRole("button", { name: "MAX" })
				.click();
			await limitedObjectRequest;
			expect(
				Number(new URL(page.url()).searchParams.get("limit")),
			).toBeGreaterThan(250);
			const objectRow = page.getByRole("row").filter({ hasText: objectName });
			await expect(
				objectRow.locator('td[data-column-key^="computed:"]', {
					hasText: "e2e-host",
				}),
			).toHaveCount(2);

			const findOnPage = page.getByLabel("Find objects on this loaded page");
			await findOnPage.fill("e2e-host");
			await findOnPage.press("Enter");
			await expect
				.poll(() => new URL(page.url()).searchParams.get("search"))
				.toBe("e2e-host");
			await page.getByRole("button", { name: "Aggregate" }).click();
			const groupingMenu = page.getByRole("dialog", {
				name: "Group objects",
			});
			await groupingMenu
				.getByLabel("Group by")
				.selectOption({ label: "Shared · Shared hostname" });
			await expect(findOnPage).toBeDisabled();
			await expect(findOnPage).toHaveValue("");
			await expect
				.poll(() => new URL(page.url()).searchParams.get("search"))
				.toBeNull();
			await expect(groupingMenu.getByLabel("Sort groups")).toHaveValue(
				"count-desc",
			);
			await page.keyboard.press("Escape");
			const groupedTable = page.getByRole("region", {
				name: "Object aggregates",
			});
			const hostnameGroup = groupedTable
				.getByRole("row")
				.filter({ hasText: "e2e-host" });
			await expect(hostnameGroup.getByRole("cell").nth(1)).toHaveText("2");
			await expect(
				groupedTable.getByRole("columnheader", { name: /Count/ }),
			).toHaveAttribute("aria-sort", "descending");
			await groupedTable
				.getByRole("button", { name: /Shared · Shared hostname/ })
				.click();
			await expect(
				groupedTable.getByRole("columnheader", {
					name: /Shared · Shared hostname/,
				}),
			).toHaveAttribute("aria-sort", "ascending");
			const groupedResults = await new AxeBuilder({ page })
				.include(".objects-resource-index")
				.analyze();
			expect(
				groupedResults.violations.filter((violation) =>
					["serious", "critical"].includes(violation.impact ?? ""),
				),
			).toEqual([]);

			await page.goto(`/objects/${hubuumClass.id}/${object.id}`);
			const connectionsSection = page.locator("#object-connections");
			const connectionsHeader = connectionsSection.locator(":scope > header");
			await expect(
				connectionsHeader.getByRole("heading", { name: "Connections" }),
			).toBeVisible();
			const depthPicker = connectionsHeader.getByRole("group", {
				name: "Connection depth",
			});
			await expect(depthPicker).toBeVisible();
			await expect(depthPicker.getByRole("button")).toHaveCount(4);
			await expect(
				depthPicker.getByRole("button", { name: "2" }),
			).toHaveAttribute("aria-pressed", "true");
			await depthPicker.getByRole("button", { name: "3" }).click();
			await expect(
				depthPicker.getByRole("button", { name: "3" }),
			).toHaveAttribute("aria-pressed", "true");
			await expect(
				connectionsHeader.locator(".relations-toggle"),
			).toContainText("Include e2e_computed_class_");
			await connectionsHeader
				.getByRole("button", { name: "Class filters" })
				.click();
			await expect(
				connectionsHeader.getByText("Hide classes", { exact: true }),
			).toBeVisible();
			await page.keyboard.press("Escape");
			await expect(
				page.getByText("Connection paths and filters", { exact: true }),
			).toHaveCount(0);
			await expect(page.locator(".object-record-heading .eyebrow")).toHaveCount(
				0,
			);
			await expect(
				page.locator(".object-property-section--data > header .eyebrow"),
			).toHaveCount(0);
			await expect(connectionsHeader.locator(".eyebrow")).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Edit all" })).toHaveCount(
				0,
			);
			await page.getByRole("button", { name: /Edit object name\./ }).click();
			const nameInput = page.getByLabel("Object name");
			const nameValueCell = page
				.locator(".object-fact-value")
				.filter({ has: nameInput });
			const [nameInputBox, nameValueCellBox] = await Promise.all([
				nameInput.boundingBox(),
				nameValueCell.boundingBox(),
			]);
			if (!nameInputBox || !nameValueCellBox) {
				throw new Error("Object name editor did not produce layout boxes.");
			}
			expect(nameInputBox.x).toBeGreaterThanOrEqual(nameValueCellBox.x - 1);
			expect(nameInputBox.x + nameInputBox.width).toBeLessThanOrEqual(
				nameValueCellBox.x + nameValueCellBox.width + 1,
			);
			await page.keyboard.press("Escape");
			await expect(
				page.getByRole("heading", { name: "Computed values" }),
			).toBeVisible();
			await expect(page.getByText("Derived data", { exact: true })).toHaveCount(
				0,
			);
			await expect(
				page.getByText("shared_hostname", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByText("personal_hostname", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByText(
					"Click a field to edit · Enter saves the field · Esc cancels",
					{ exact: true },
				),
			).toBeVisible();
			const nestedPath = page
				.locator("dt")
				.filter({ hasText: "network.interfaces[0].name" });
			await expect(nestedPath).toHaveCSS("white-space", "nowrap");
			await page
				.getByRole("button", {
					name: /Edit network\.interfaces\[0\]\.name\./,
				})
				.click();
			const inlineType = page.getByLabel("Type for network.interfaces[0].name");
			const inlineValue = page.getByLabel(
				"Value for network.interfaces[0].name",
			);
			const [typeBox, valueBox] = await Promise.all([
				inlineType.boundingBox(),
				inlineValue.boundingBox(),
			]);
			if (!typeBox || !valueBox) {
				throw new Error("Inline data controls did not produce layout boxes.");
			}
			expect(typeBox.width).toBeLessThan(120);
			expect(valueBox.width).toBeGreaterThan(typeBox.width);
			await page.keyboard.press("Escape");

			await page.getByRole("button", { name: /Edit as JSON/ }).click();
			await expect(page.getByLabel("Data (JSON)")).toBeVisible();
			await page.getByLabel("Data (JSON)").fill(
				JSON.stringify(
					{
						hostname: "e2e-host-updated",
						network: { interfaces: [{ name: "eth0" }] },
						port: 443,
					},
					null,
					2,
				),
			);
			const changeReview = page.locator(".object-data-change-review");
			await expect(
				changeReview.getByText("1 change", { exact: true }),
			).toBeVisible();
			await expect(
				changeReview.getByText("hostname", { exact: true }),
			).toBeVisible();
			const patchRequestPromise = page.waitForRequest(
				(request) =>
					request.method() === "PATCH" &&
					new URL(request.url()).pathname.endsWith(
						`/api/v1/classes/${hubuumClass.id}/${object.id}/data`,
					),
			);
			await page.getByRole("button", { name: "Save changes" }).click();
			const patchRequest = await patchRequestPromise;
			expect(patchRequest.postDataJSON() as unknown).toEqual([
				{ op: "test", path: "/hostname", value: "e2e-host" },
				{
					op: "replace",
					path: "/hostname",
					value: "e2e-host-updated",
				},
			]);
			await expect(
				page.getByText("Object updated.", { exact: true }),
			).toBeVisible();
			await page.reload();
			await expect(
				page.getByRole("heading", { name: objectName }),
			).toBeVisible();

			await expect(
				page.getByRole("heading", { name: "Object audit and history" }),
			).toBeVisible();
			const auditEventRow = page
				.getByRole("row", { name: /^View details for audit event / })
				.first();
			await expect(auditEventRow).toBeVisible();
			await auditEventRow.click();
			const auditDialog = page.getByRole("dialog", {
				name: /Audit event #/,
			});
			await expect(auditDialog.getByText("State changes")).toBeVisible();
			await expect(
				auditDialog.locator(".event-diff-summary .status-pill"),
			).toHaveCSS("white-space", "nowrap");
			await expect(
				auditDialog.getByRole("button", { name: "Previous audit event" }),
			).toBeDisabled();
			await expect(
				auditDialog.getByRole("button", { name: "Previous audit event" }),
			).toHaveCSS("opacity", "0.38");
			const nextAuditEvent = auditDialog.getByRole("button", {
				name: "Next audit event",
			});
			await expect(nextAuditEvent).toBeEnabled();
			await nextAuditEvent.click();
			await expect(
				auditDialog.getByRole("button", { name: "Previous audit event" }),
			).toBeEnabled();
			await auditDialog.getByRole("button", { name: "Close dialog" }).click();

			const historyRow = page
				.getByRole("row", { name: /^View details for history version / })
				.first();
			await expect(historyRow).toBeVisible();
			await historyRow.click();
			const historyDialog = page.getByRole("dialog", {
				name: /History version #/,
			});
			await expect(historyDialog.getByText("Stored state")).toBeVisible();
			await expect(
				historyDialog.getByRole("button", {
					name: "Previous history version",
				}),
			).toBeDisabled();
			const nextHistoryVersion = historyDialog.getByRole("button", {
				name: "Next history version",
			});
			await expect(nextHistoryVersion).toBeEnabled();
			await page.keyboard.press("ArrowRight");
			await expect(
				historyDialog.getByRole("button", {
					name: "Previous history version",
				}),
			).toBeEnabled();
			await historyDialog.getByRole("button", { name: "Close dialog" }).click();

			await page.goto("/audit");
			const globalAuditRow = page
				.getByRole("row", { name: /^View details for event / })
				.first();
			await expect(globalAuditRow).toBeVisible();
			await globalAuditRow.press("Enter");
			const globalAuditDialog = page.getByRole("dialog", {
				name: /Audit event #/,
			});
			await expect(globalAuditDialog.getByText("State changes")).toBeVisible();
			await expect(
				globalAuditDialog.getByRole("button", {
					name: "Previous audit event",
				}),
			).toBeVisible();
			await expect(
				globalAuditDialog.getByRole("button", { name: "Next audit event" }),
			).toBeVisible();
			await globalAuditDialog
				.getByRole("button", { name: "Close dialog" })
				.click();
		} finally {
			if (objectId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/classes/${hubuumClass.id}/${objectId}`,
					{ headers: { Origin: new URL(page.url()).origin } },
				);
			}
			if (previewObjectId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/classes/${hubuumClass.id}/${previewObjectId}`,
					{ headers: { Origin: new URL(page.url()).origin } },
				);
			}
			await page.request.delete(
				`${bffPrefix}/api/v1/classes/${hubuumClass.id}`,
				{ headers: { Origin: new URL(page.url()).origin } },
			);
			await page.request.delete(
				`${bffPrefix}/api/v1/collections/${collection.id}`,
				{ headers: { Origin: new URL(page.url()).origin } },
			);
		}
	});
});
