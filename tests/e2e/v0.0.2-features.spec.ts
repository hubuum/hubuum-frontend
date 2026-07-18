import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Request, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";
const bffPrefix = "/_hubuum-bff/hubuum";

async function signIn(page: Page) {
	await page.goto("/login");
	await expect(
		page.getByText(
			/Choose the identity provider|Leave blank for local accounts/,
		),
	).toBeVisible();
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

test.describe("v0.0.2 server features", () => {
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
			page.getByRole("heading", { name: "Backup & restore" }),
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
						data: { hostname: "e2e-host", port: 443 },
						description: "Computed-field preview object",
						hubuum_class_id: hubuumClass.id,
						name: previewObjectName,
					},
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
						data: { hostname: "e2e-host", port: 443 },
						description: "Computed-field object",
						hubuum_class_id: hubuumClass.id,
						name: objectName,
					},
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

			await page.getByRole("button", { name: "Group" }).click();
			const groupingMenu = page.getByRole("dialog", {
				name: "Group loaded rows",
			});
			await groupingMenu
				.getByLabel("Group by")
				.selectOption({ label: "Shared · Shared hostname" });
			await expect(groupingMenu.getByLabel("Sort groups")).toHaveValue(
				"count-desc",
			);
			await page.keyboard.press("Escape");
			const groupedTable = page.getByRole("region", {
				name: "Grouped objects",
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
			await expect(
				page.getByRole("heading", { name: "Computed values" }),
			).toBeVisible();
			await expect(
				page.getByText("shared_hostname", { exact: true }),
			).toBeVisible();
			await expect(
				page.getByText("personal_hostname", { exact: true }),
			).toBeVisible();
		} finally {
			if (objectId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/classes/${hubuumClass.id}/${objectId}`,
				);
			}
			if (previewObjectId !== null) {
				await page.request.delete(
					`${bffPrefix}/api/v1/classes/${hubuumClass.id}/${previewObjectId}`,
				);
			}
			await page.request.delete(
				`${bffPrefix}/api/v1/classes/${hubuumClass.id}`,
			);
			await page.request.delete(
				`${bffPrefix}/api/v1/collections/${collection.id}`,
			);
		}
	});
});
