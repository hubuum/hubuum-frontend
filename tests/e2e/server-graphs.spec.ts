import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const api = "/_hubuum-bff/hubuum/api/v1";
const nodes = [
	{ id: 1, name: "Root class", description: "Root description", path: [1] },
	{
		id: 2,
		name: "Related class",
		description: "Related description",
		path: [1, 2],
	},
];
test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires disposable authenticated backend",
	);
	await page.goto("/login");
	expect(
		(
			await page.request.post("/_hubuum-bff/auth/login", {
				headers: { Origin: new URL(page.url()).origin },
				data: {
					username: process.env.E2E_USERNAME ?? "admin",
					password: process.env.E2E_PASSWORD,
					identity_scope: "local",
				},
			})
		).status(),
	).toBe(200);
});

test("bounded graph controls, keyboard inspection, tables and mobile accessibility", async ({
	page,
}) => {
	const requests: URL[] = [];
	await page.route(`**${api}/classes/1/related/graph?**`, (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		return route.fulfill({
			json: {
				classes: nodes,
				relations: [{ id: 5, from_hubuum_class_id: 1, to_hubuum_class_id: 2 }],
			},
		});
	});
	await page.goto("/classes/1/graph");
	await expect(
		page.getByText("2 nodes, including the root", { exact: false }),
	).toBeVisible();
	const related = page.getByRole("button", {
		name: "Inspect Related class (#2)",
		exact: true,
	});
	await related.focus();
	await page.keyboard.press("Enter");
	await expect(related).toHaveAttribute("aria-pressed", "true");
	await expect(
		page.getByRole("region", { name: "Selected node" }),
	).toContainText("Related description");
	await expect(
		page.getByRole("link", { name: "Open class", exact: true }),
	).toHaveAttribute("href", "/classes/2");
	await page.getByText("Direct relations (1)", { exact: true }).click();
	await expect(
		page.getByRole("table", { name: "Direct neighborhood relations" }),
	).toContainText("Related class (#2)");
	await page.getByLabel("Maximum depth").fill("1");
	await page.getByLabel("Maximum related nodes").selectOption("25");
	await page.getByRole("button", { name: "Load graph", exact: true }).click();
	await expect(
		page.getByText("maximum depth 1", { exact: false }),
	).toBeVisible();
	expect(requests.at(-1)?.searchParams.get("depth__lte")).toBe("1");
	expect(requests.at(-1)?.searchParams.get("limit")).toBe("25");
	expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByText("Nodes (2)", { exact: true }).click();
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= window.innerWidth,
		),
	).toBe(true);
	expect(
		(
			await new AxeBuilder({ page })
				.include("main")
				.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
				.analyze()
		).violations,
	).toEqual([]);
});

test("bound failures stay explicit without an unbounded fallback", async ({
	page,
}) => {
	let requests = 0;
	await page.route(`**${api}/classes/1/related/graph?**`, (route) => {
		requests++;
		return route.fulfill({
			status: 400,
			json: { message: "Graph exceeds requested bound" },
		});
	});
	await page.goto("/classes/1/graph");
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Graph exceeds requested bound" }),
	).toBeVisible();
	await expect(
		page.getByRole("region", { name: "Neighborhood diagram" }),
	).toHaveCount(0);
	const before = requests;
	await page.getByLabel("Maximum depth").fill("1");
	await page.getByRole("button", { name: "Load graph", exact: true }).click();
	await expect.poll(() => requests).toBe(before + 1);
});

test("live class and object neighborhoods include their direct relations", async ({
	page,
}) => {
	test.setTimeout(90_000);
	const headers = { Origin: new URL(page.url()).origin };
	const cleanup: string[] = [];
	const create = async (path: string, data: unknown) => {
		const url = /^\/classes\/\d+\/$/.test(path)
			? `/_hubuum-bff${path}objects`
			: `${api}${path}`;
		const response = await page.request.post(url, {
			headers,
			data,
		});
		expect(response.status(), `Create ${path}`).toBe(201);
		const result: { id: number } = await response.json();
		cleanup.push(`${path.replace(/\/$/, "")}/${result.id}`);
		return result.id;
	};
	try {
		const groups = await page.request.get(
			`${api}/iam/groups?limit=1&include_total=false`,
		);
		expect(groups.status()).toBe(200);
		const groupId = ((await groups.json()) as { id: number }[])[0].id;
		const suffix = Date.now();
		const collectionId = await create("/collections", {
			name: `Graph ${suffix}`,
			description: "Graph regression",
			group_id: groupId,
		});
		const classA = await create("/classes", {
			name: `Graph A ${suffix}`,
			description: "Root class",
			collection_id: collectionId,
			validate_schema: false,
		});
		const classB = await create("/classes", {
			name: `Graph B ${suffix}`,
			description: "Related class",
			collection_id: collectionId,
			validate_schema: false,
		});
		await create(`/classes/${classA}/relations`, {
			to_hubuum_class_id: classB,
		});
		const objectA = await create(`/classes/${classA}/`, {
			name: `Object A ${suffix}`,
			description: "Root object",
			collection_id: collectionId,
			hubuum_class_id: classA,
			data: {},
		});
		const objectB = await create(`/classes/${classB}/`, {
			name: `Object B ${suffix}`,
			description: "Related object",
			collection_id: collectionId,
			hubuum_class_id: classB,
			data: {},
		});
		const relationPath = `/classes/${classA}/${objectA}/relations/${classB}/${objectB}`;
		expect(
			(await page.request.post(`${api}${relationPath}`, { headers })).status(),
		).toBe(201);
		cleanup.push(relationPath);
		for (const path of [
			`/classes/${classA}/graph`,
			`/objects/${classA}/${objectA}/graph`,
		]) {
			await page.goto(path);
			await expect(
				page.getByText("2 nodes, including the root · 1 direct relations", {
					exact: false,
				}),
			).toBeVisible();
			await page.getByRole("button", { name: /^Inspect .* B / }).click();
			await expect(
				page.getByRole("region", { name: "Selected node" }),
			).toContainText(/Related (class|object)/);
			await page.getByRole("link", { name: /^Open (class|object)$/ }).click();
			await page
				.getByRole("link", { name: "Neighborhood graph", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: /neighborhood graph$/ }),
			).toBeVisible();
		}
	} finally {
		for (const path of cleanup.reverse()) {
			const response = await page.request.delete(`${api}${path}`, { headers });
			expect([204, 404], `Cleanup ${path}`).toContain(response.status());
		}
	}
});
