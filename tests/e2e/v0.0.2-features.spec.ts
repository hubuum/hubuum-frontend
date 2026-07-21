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
						data: {
							hostname: "e2e-host",
							network: { interfaces: [{ name: "eth0" }] },
							port: 443,
						},
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
						data: {
							hostname: "e2e-host",
							network: { interfaces: [{ name: "eth0" }] },
							port: 443,
						},
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
				name: "Group objects",
			});
			await groupingMenu
				.getByLabel("Group by")
				.selectOption({ label: "Shared · Shared hostname" });
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

			const activityPanel = page.getByRole("article").filter({
				has: page.getByRole("heading", { name: "Object audit and history" }),
			});
			const auditSection = activityPanel.locator("section").filter({
				has: page.getByText("Recent audit events", { exact: true }),
			});
			const auditEventRow = auditSection.locator("tbody tr").first();
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

			const historySection = activityPanel.locator("section").filter({
				has: page.getByText("Version history", { exact: true }),
			});
			const historyRow = historySection.locator("tbody tr").first();
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
			const globalAuditRow = page.locator("tbody tr").first();
			await expect(globalAuditRow).toBeVisible();
			await globalAuditRow.click();
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
