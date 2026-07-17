import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const identityScope = process.env.E2E_IDENTITY_SCOPE ?? "local";
const bffPrefix = "/_hubuum-bff/hubuum";

async function signIn(page: Page) {
	await page.goto("/login");
	const provider = page.locator("#identity-scope");
	await expect(provider).toBeVisible();
	if ((await provider.evaluate((element) => element.tagName)) === "SELECT") {
		await provider.selectOption(identityScope);
	} else {
		await provider.fill(identityScope);
	}
	await page.getByLabel("Username").fill(username ?? "");
	await page.getByLabel("Password").fill(password ?? "");
	await page.getByRole("button", { name: "Enter workspace" }).click();
	await page.waitForURL("**/app");
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
					json_schema: {},
					name: `e2e_computed_class_${suffix}`,
					validate_schema: false,
				},
			},
		);
		expect(classResponse.status()).toBe(201);
		const hubuumClass = (await classResponse.json()) as { id: number };
		let objectId: number | null = null;

		try {
			await page.goto(`/classes/${hubuumClass.id}#computed-fields`);
			const sharedCard = page.getByRole("article").filter({
				has: page.getByRole("heading", { name: "Shared fields" }),
			});
			await sharedCard.getByRole("button", { name: "New field" }).click();
			await sharedCard.getByLabel("Key").fill("shared_hostname");
			await sharedCard.getByLabel("Label").fill("Shared hostname");
			await sharedCard
				.getByLabel("JSON Pointer paths, one per line")
				.fill("/hostname");
			await sharedCard.getByRole("button", { name: "Save field" }).click();
			await expect(
				sharedCard.getByText("shared_hostname", { exact: true }),
			).toBeVisible();

			const personalCard = page.getByRole("article").filter({
				has: page.getByRole("heading", { name: "Personal fields" }),
			});
			await personalCard.getByRole("button", { name: "New field" }).click();
			await personalCard.getByLabel("Key").fill("personal_hostname");
			await personalCard.getByLabel("Label").fill("Personal hostname");
			await personalCard
				.getByLabel("JSON Pointer paths, one per line")
				.fill("/hostname");
			await personalCard.getByRole("button", { name: "Save field" }).click();
			await expect(
				personalCard.getByText("personal_hostname", { exact: true }),
			).toBeVisible();

			const objectResponse = await page.request.post(
				`/_hubuum-bff/classes/${hubuumClass.id}/objects`,
				{
					data: {
						collection_id: collection.id,
						data: { hostname: "e2e-host" },
						description: "Computed-field object",
						hubuum_class_id: hubuumClass.id,
						name: `e2e_computed_object_${suffix}`,
					},
				},
			);
			expect(objectResponse.status()).toBe(201);
			const object = (await objectResponse.json()) as { id: number };
			objectId = object.id;

			await page.goto(`/objects?classId=${hubuumClass.id}`);
			await expect(
				page.getByRole("columnheader", { name: /shared.*Shared hostname/i }),
			).toBeVisible();
			await expect(
				page.getByRole("columnheader", {
					name: /personal.*Personal hostname/i,
				}),
			).toBeVisible();
			await expect(
				page.locator('td[data-column-key^="computed:"]', {
					hasText: "e2e-host",
				}),
			).toHaveCount(2);

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
			await page.request.delete(
				`${bffPrefix}/api/v1/classes/${hubuumClass.id}`,
			);
			await page.request.delete(
				`${bffPrefix}/api/v1/collections/${collection.id}`,
			);
		}
	});
});
