import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const prefix = "/_hubuum-bff/hubuum/api/v1";
test.use({ trace: "off" });
test("discovers structured fields and selects literal properties and array inputs", async ({
	page,
}) => {
	test.skip(
		!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
		"Requires an authenticated test session.",
	);
	await page.goto("/login");
	await expect(
		page.getByRole("form", { name: "Login form" }),
	).not.toHaveAttribute("data-provider-discovery", "loading");
	const provider = page.locator("#identity-scope");
	if (await page.locator("select#identity-scope").isVisible())
		await provider.selectOption("local");
	else if ((await provider.getAttribute("type")) !== "hidden")
		await provider.fill("local");
	await page.getByLabel("Username").fill(process.env.E2E_USERNAME ?? "");
	await page
		.getByLabel("Password", { exact: true })
		.fill(process.env.E2E_PASSWORD ?? "");
	await page.getByRole("button", { name: "Enter workspace" }).click();
	await page.waitForURL("**/app");
	const headers = { Origin: new URL(page.url()).origin };
	const groups = await (
		await page.request.get(`${prefix}/iam/groups?limit=1&include_total=false`)
	).json();
	const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
	const collectionResponse = await page.request.post(`${prefix}/collections`, {
		headers,
		data: {
			name: `discovery_${suffix}`,
			description: "Discovery browser fixture",
			group_id: groups[0].id,
		},
	});
	expect(collectionResponse.status()).toBe(201);
	const collection = await collectionResponse.json();
	let classId: number | undefined;
	let objectId: number | undefined;
	try {
		const classResponse = await page.request.post(`${prefix}/classes`, {
			headers,
			data: {
				name: `fields_${suffix}`,
				description: "Discovery browser fixture",
				collection_id: collection.id,
			},
		});
		expect(classResponse.status()).toBe(201);
		classId = (await classResponse.json()).id;
		const objectResponse = await page.request.post(
			`/_hubuum-bff/classes/${classId}/objects`,
			{
				headers,
				data: {
					name: `object_${suffix}`,
					description: "Structured fields",
					hubuum_class_id: classId,
					collection_id: collection.id,
					data: { "[#]": "literal", "a.b": true, a: { b: 7 }, values: [1, 2] },
				},
			},
		);
		expect(objectResponse.status()).toBe(201);
		objectId = (await objectResponse.json()).id;
		const fullObjectReads: string[] = [];
		page.on("request", (request) => {
			if (
				request.method() === "GET" &&
				[
					`${prefix}/classes/${classId}/`,
					`/_hubuum-bff/classes/${classId}/objects`,
				].includes(new URL(request.url()).pathname)
			)
				fullObjectReads.push(request.url());
		});
		await page.goto(`/classes/${classId}`);
		const discovery = page.getByRole("region", { name: "Discover fields" });
		await expect(discovery).toContainText("Sampled 1 authorized objects");
		await discovery.getByLabel("Search discovered fields").fill("[#]");
		await expect(discovery).toContainText("1 matching fields");
		await discovery.getByText("Structured path", { exact: true }).click();
		await expect(discovery.locator("pre")).toContainText('"name": "[#]"');
		expect(
			(
				await new AxeBuilder({ page })
					.include("#class-field-discovery")
					.analyze()
			).violations,
		).toEqual([]);
		await page.setViewportSize({ width: 390, height: 844 });
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			)
			.toBe(true);
		await page.setViewportSize({ width: 1440, height: 900 });
		const personal = page.getByRole("article").filter({
			has: page.getByRole("heading", {
				name: "Personal fields",
				exact: true,
			}),
		});
		await personal.getByRole("button", { name: "New field" }).click();
		const editor = page.getByRole("article").filter({
			has: page.getByRole("heading", {
				name: "New personal computed field",
				exact: true,
			}),
		});
		await editor.getByRole("button", { name: "Continue to inputs" }).click();
		await editor
			.getByRole("button", {
				name: 'Add ["[#]"] to selected inputs',
				exact: true,
			})
			.click();
		await expect(
			editor.getByRole("button", {
				name: "Remove /[#] from selected inputs",
				exact: true,
			}),
		).toBeVisible();
		const array = editor.locator("li").filter({
			has: page.getByRole("button", {
				name: "Add values[] to selected inputs",
				exact: true,
			}),
		});
		await expect(array.getByRole("button")).toBeDisabled();
		await array.getByLabel("Array index 1").fill("1");
		await array.getByRole("button").click();
		await expect(
			editor.getByRole("button", {
				name: "Remove /values/1 from selected inputs",
				exact: true,
			}),
		).toBeVisible();
		expect(fullObjectReads).toEqual([]);
	} finally {
		if (objectId && classId)
			await page.request.delete(`${prefix}/classes/${classId}/${objectId}`, {
				headers,
			});
		if (classId)
			await page.request.delete(`${prefix}/classes/${classId}`, { headers });
		await page.request.delete(`${prefix}/collections/${collection.id}`, {
			headers,
		});
	}
});
