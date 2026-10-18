import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
const prefix = "/_hubuum-bff/hubuum/api/v1";
const instant = "2026-10-01T12:00:00.123456789Z";
const template = {
	id: 7,
	revision: 2,
	collection_id: 1,
	kind: "export",
	scope_kind: "collections",
	content_type: "text/plain",
	name: "History template",
	description: "",
	template: "Saved report",
	created_at: instant,
	updated_at: instant,
};
const version = {
	...template,
	history_id: 51,
	op: "UPDATE",
	valid_from: instant,
	valid_to: null,
	actor_username: "admin",
	provenance: {},
};
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
for (const kind of ["remote-targets", "export-templates"] as const) {
	test(`${kind} loads older revisions, preserves timestamp precision, and handles missing snapshots`, async ({
		page,
	}) => {
		const requests: URL[] = [];
		await page.route(`**${prefix}/export-templates**`, (route) =>
			route.fulfill({
				json: new URL(route.request().url()).pathname.endsWith("/7")
					? template
					: [template],
			}),
		);
		await page.route(`**${prefix}/${kind}/7/history**`, (route) => {
			const url = new URL(route.request().url());
			requests.push(url);
			if (url.pathname.endsWith("as-of"))
				return url.searchParams.get("at") === instant
					? route.fulfill({ json: version })
					: route.fulfill({ status: 404, json: { message: "Not found" } });
			return route.fulfill({
				headers: url.searchParams.has("cursor")
					? {}
					: { "X-Next-Cursor": "older-50" },
				json: url.searchParams.has("cursor")
					? [{ ...version, history_id: 1, valid_from: "2026-09-01T00:00:00Z" }]
					: [version],
			});
		});
		if (kind === "remote-targets")
			await page.goto("/admin/remote-targets/7/history");
		else {
			await page.goto("/exports/templates/7");
			await page.getByRole("tab", { name: /History/ }).click();
		}
		const history = page.getByRole("region", {
			name: "Saved history",
			exact: true,
		});
		await expect(
			history.getByRole("article", {
				name: "History revision 51",
				exact: true,
			}),
		).toBeVisible();
		await history.getByRole("button", { name: "Load older versions" }).click();
		await expect(
			history.getByRole("article", { name: "History revision 1", exact: true }),
		).toBeVisible();
		expect(
			requests.some((url) => url.searchParams.get("cursor") === "older-50"),
		).toBe(true);
		await history
			.getByRole("button", {
				name: "Inspect state at history #51",
				exact: true,
			})
			.click();
		await expect(
			history.getByRole("region", { name: "Historical snapshot" }),
		).toContainText(instant);
		expect(requests.at(-1)?.searchParams.get("at")).toBe(instant);
		await history.getByLabel("Snapshot timestamp").fill("2020-01-01T00:00:00Z");
		await history
			.getByRole("button", { name: "Inspect snapshot", exact: true })
			.click();
		await expect(
			history.getByRole("region", { name: "Historical snapshot" }),
		).toContainText("No accessible snapshot");
		await page.setViewportSize({ width: 390, height: 844 });
		expect(
			(
				await new AxeBuilder({ page })
					.include('section[aria-label="Saved history"]')
					.analyze()
			).violations,
		).toEqual([]);
	});
}
test("reads remote-target and template snapshots through the live BFF", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const headers = { Origin: new URL(page.url()).origin };
	const suffix = randomUUID();
	const groupResponse = await page.request.post(`${prefix}/iam/groups`, {
		headers,
		data: { groupname: `history-${suffix}`, description: "History test" },
	});
	expect(groupResponse.status()).toBe(201);
	const group = await groupResponse.json();
	const collectionResponse = await page.request.post(`${prefix}/collections`, {
		headers,
		data: {
			name: `history-${suffix}`,
			description: "History test",
			group_id: group.id,
		},
	});
	expect(collectionResponse.status()).toBe(201);
	const collection = await collectionResponse.json();
	let targetId: number | undefined;
	let templateId: number | undefined;
	try {
		const targetResponse = await page.request.post(`${prefix}/remote-targets`, {
			headers,
			data: {
				collection_id: collection.id,
				name: `target-${suffix}`,
				description: "Original target",
				method: "get",
				url_template: "https://example.test/never-called",
				allowed_subject_types: ["collection"],
				enabled: false,
			},
		});
		expect(targetResponse.status()).toBe(201);
		targetId = (await targetResponse.json()).id;
		expect(
			(
				await page.request.patch(`${prefix}/remote-targets/${targetId}`, {
					headers,
					data: { description: "Updated target" },
				})
			).status(),
		).toBe(200);
		await page.goto(`/admin/remote-targets/${targetId}/history`);
		const history = page.getByRole("region", {
			name: "Saved history",
			exact: true,
		});
		await expect(history.getByRole("article")).toHaveCount(2);
		await history
			.getByRole("button", { name: /Inspect state at history/ })
			.last()
			.click();
		await expect(
			history.getByRole("region", { name: "Historical snapshot" }),
		).toBeVisible();
		const templateResponse = await page.request.post(
			`${prefix}/export-templates`,
			{
				headers,
				data: {
					collection_id: collection.id,
					name: `template-${suffix}`,
					description: "Historical report",
					scope_kind: "collections",
					kind: "export",
					content_type: "text/plain",
					template: "Original content",
				},
			},
		);
		expect(templateResponse.status(), await templateResponse.text()).toBe(201);
		templateId = (await templateResponse.json()).id;
		expect(
			(
				await page.request.patch(`${prefix}/export-templates/${templateId}`, {
					headers,
					data: { template: "Updated content" },
				})
			).status(),
		).toBe(200);
		await page.goto(`/exports/templates/${templateId}`);
		await page.getByRole("tab", { name: /History/ }).click();
		await expect(history.getByRole("article")).toHaveCount(2);
		await history
			.getByRole("button", { name: /Inspect state at history/ })
			.last()
			.click();
		const snapshot = history.getByRole("region", {
			name: "Historical snapshot",
		});
		await snapshot.getByText("View saved content", { exact: true }).click();
		await expect(
			snapshot
				.getByText("Original content", { exact: true })
				.filter({ visible: true }),
		).toBeVisible();
	} finally {
		if (targetId)
			await page.request
				.delete(`${prefix}/remote-targets/${targetId}`, { headers })
				.catch(() => undefined);
		if (templateId)
			await page.request
				.delete(`${prefix}/export-templates/${templateId}`, { headers })
				.catch(() => undefined);
		await page.request
			.delete(`${prefix}/collections/${collection.id}`, { headers })
			.catch(() => undefined);
		await page.request
			.delete(`${prefix}/iam/groups/${group.id}`, { headers })
			.catch(() => undefined);
	}
});
