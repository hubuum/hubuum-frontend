import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
const prefix = "/_hubuum-bff/hubuum";
test.use({ trace: "off", screenshot: "off", video: "off" });
async function login(
	page: Page,
	username = process.env.E2E_USERNAME ?? "admin",
	password = process.env.E2E_PASSWORD,
) {
	await page.goto("/login");
	expect(
		(
			await page.request.post("/_hubuum-bff/auth/login", {
				headers: { Origin: new URL(page.url()).origin },
				data: { username, password, identity_scope: "local" },
			})
		).status(),
	).toBe(200);
}
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires disposable authenticated server",
	);
	await login(page);
});
test("filters login limits and confirms individual and global release", async ({
	page,
}) => {
	const requests: string[] = [];
	await page.route(`**${prefix}/api/v0/meta/login-rate-limit**`, (route) => {
		requests.push(
			`${route.request().method()} ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`,
		);
		return route.fulfill({
			json:
				route.request().method() === "GET"
					? {
							config: { enabled: true, backend: "memory" },
							tracked_entries: 2,
							locked_entries: 1,
							returned_entries: 1,
							entries: [
								{
									id: "opaque",
									identifier: "user@example.test / 127.0.0.1",
									scope: "user_ip",
									attempts: 5,
									locked: true,
									locked_for_seconds: 30,
									lockout_level: 2,
								},
							],
						}
					: { released: true, cleared: 2 },
		});
	});
	await page.goto("/admin/security");
	await expect(page.getByText(/tracked;.*shown/)).toBeVisible();
	const panel = page.getByRole("region", {
		name: "Login rate limits",
		exact: true,
	});
	await expect(panel.getByText("30s remaining")).toBeVisible();
	await panel
		.getByRole("combobox", { name: "Entries", exact: true })
		.selectOption("all");
	await panel
		.getByRole("combobox", { name: "Scope", exact: true })
		.selectOption("user_ip");
	await panel.getByLabel("Identifier contains").fill("user@");
	await panel.getByRole("button", { name: "Apply filters" }).click();
	await expect
		.poll(() =>
			requests.some(
				(url) =>
					url.includes("include=all") &&
					url.includes("scope=user_ip") &&
					url.includes("q=user%40"),
			),
		)
		.toBe(true);
	await panel.getByRole("button", { name: "Release", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
	expect(requests.some((x) => x.startsWith("DELETE"))).toBe(false);
	await panel.getByRole("button", { name: "Release", exact: true }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Release", exact: true })
		.click();
	await expect
		.poll(() => requests.filter((x) => x.startsWith("DELETE")))
		.toEqual([`DELETE ${prefix}/api/v0/meta/login-rate-limit/opaque`]);
	await panel.getByRole("button", { name: "Clear all limits" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Clear all", exact: true })
		.click();
	await expect
		.poll(() => requests.filter((x) => x.startsWith("DELETE")).length)
		.toBe(2);
	expect(
		(
			await new AxeBuilder({ page })
				.include('section[aria-label="Login rate limits"]')
				.analyze()
		).violations,
	).toEqual([]);
});
test("retains a settings draft after a conflict and supports merge, JSON Patch, and reset", async ({
	page,
}) => {
	const writes: {
		method: string;
		etag: string;
		contentType: string;
		body: unknown;
	}[] = [];
	let revision = 3;
	let conflict = true;
	await page.route(`**${prefix}/api/v1/iam/principals/42/settings`, (route) => {
		const request = route.request();
		if (request.method() !== "GET") {
			writes.push({
				method: request.method(),
				etag: request.headers()["if-match"],
				contentType: request.headers()["content-type"],
				body: request.postDataJSON(),
			});
			if (conflict) {
				conflict = false;
				return route.fulfill({
					status: 412,
					json: { message: "Settings changed concurrently" },
				});
			}
			revision++;
			if (request.method() === "DELETE") return route.fulfill({ status: 204 });
		}
		return route.fulfill({
			headers: { ETag: `"settings-${revision}"` },
			json: { revision, settings: { theme: "dark" } },
		});
	});
	await page.goto("/admin/security");
	await expect(page.getByText(/tracked;.*shown/)).toBeVisible();
	const panel = page.getByRole("region", {
		name: "Principal settings",
		exact: true,
	});
	await panel.getByLabel("Principal ID", { exact: true }).fill("42");
	await panel.getByRole("button", { name: "Inspect settings" }).click();
	await panel.getByLabel("Settings JSON").fill('{"custom":true}');
	async function save() {
		await panel
			.getByRole("button", { name: "Save settings", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Save settings", exact: true })
			.click();
	}
	await save();
	await expect(panel.getByRole("alert")).toContainText(
		"Settings changed concurrently",
	);
	await expect(panel.getByLabel("Settings JSON")).toHaveValue(
		'{"custom":true}',
	);
	expect(writes).toHaveLength(1);
	await expect(
		panel.getByRole("button", { name: "Save settings", exact: true }),
	).toBeFocused();
	await panel
		.getByRole("combobox", { name: "Settings operation" })
		.selectOption("merge");
	await panel.getByLabel("Settings JSON").fill('{"custom":null}');
	await save();
	await expect(panel.getByText("Settings saved.")).toBeVisible();
	expect(writes[1]).toMatchObject({
		method: "PATCH",
		etag: '"settings-3"',
		contentType: "application/merge-patch+json",
		body: { custom: null },
	});
	await panel
		.getByRole("combobox", { name: "Settings operation" })
		.selectOption("patch");
	await panel
		.getByLabel("Settings JSON")
		.fill('[{"op":"test","path":"/theme","value":"dark"}]');
	await save();
	await expect.poll(() => writes.length).toBe(3);
	expect(writes[2]).toMatchObject({
		etag: '"settings-4"',
		contentType: "application/json-patch+json",
	});
	await panel
		.getByRole("button", { name: "Reset settings", exact: true })
		.click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Reset settings", exact: true })
		.click();
	await expect.poll(() => writes.length).toBe(4);
	expect(writes[3].method).toBe("DELETE");
});
test("inspects effective permissions for a selected group", async ({
	page,
}) => {
	await page.route(
		`**${prefix}/api/v1/collections/7/permissions/effective/group/3`,
		(route) =>
			route.fulfill({
				json: [
					{
						depth: 1,
						inherited: true,
						group: { id: 3, groupname: "Operators" },
						source_collection: { id: 1, name: "Parent" },
						target_collection: { id: 7, name: "Child" },
						permission: {
							id: 8,
							has_read_object: true,
							has_update_object: false,
						},
					},
				],
			}),
	);
	await page.goto("/admin/security");
	await expect(page.getByText(/tracked;.*shown/)).toBeVisible();
	const panel = page.getByRole("region", {
		name: "Effective permissions",
		exact: true,
	});
	await panel.getByLabel("Collection ID", { exact: true }).fill("7");
	await panel
		.getByRole("combobox", { name: "Permission subject" })
		.selectOption("group");
	await panel.getByLabel("Subject ID", { exact: true }).fill("3");
	await panel.getByRole("button", { name: "Inspect permissions" }).click();
	await expect(panel.getByText("Operators (#3)")).toBeVisible();
	await expect(panel.getByText("Inherited · depth 1")).toBeVisible();
	await expect(panel.getByText("read object", { exact: true })).toBeVisible();
});
test("manages live principal settings, revokes a user's tokens, and anonymizes the disposable user", async ({
	page,
	browser,
}) => {
	test.setTimeout(90_000);
	const name = `security-${randomUUID()}`;
	const password = randomUUID();
	const origin = new URL(page.url()).origin;
	const headers = { Origin: origin };
	const created = await page.request.post("/_hubuum-bff/credential-mutations", {
		headers,
		data: {
			password: process.env.E2E_PASSWORD,
			path: "/api/v1/iam/users",
			method: "POST",
			body: {
				name,
				password,
				email: "pii@example.test",
				proper_name: "Disposable Person",
			},
			ifMatch: null,
			idempotencyKey: null,
		},
	});
	expect(created.status()).toBe(201);
	const user = await created.json();
	const context = await browser.newContext({ baseURL: origin });
	const member = await context.newPage();
	try {
		await login(member, name, password);
		await page.goto(`/admin/users/${user.id}`);
		const panel = page.getByRole("region", {
			name: "Principal settings",
			exact: true,
		});
		await panel.getByLabel("Settings JSON").fill('{"test_preference":true}');
		await panel
			.getByRole("button", { name: "Save settings", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Save settings", exact: true })
			.click();
		await expect(panel.getByText("Settings saved.")).toBeVisible();
		expect(
			(
				await (
					await page.request.get(
						`${prefix}/api/v1/iam/principals/${user.id}/settings`,
					)
				).json()
			).settings,
		).toEqual({ test_preference: true });
		await page
			.getByRole("button", { name: "Revoke all tokens", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Revoke all tokens", exact: true })
			.click();
		await expect(
			page.getByText("All tokens for this user have been revoked."),
		).toBeVisible();
		expect((await member.request.get(`${prefix}/api/v1/iam/me`)).status()).toBe(
			401,
		);
		await login(member, name, password);
		await member.goto("/account/tokens");
		await member
			.getByRole("button", { name: "Revoke all tokens", exact: true })
			.click();
		await member
			.getByRole("alertdialog")
			.getByRole("button", { name: "Revoke all tokens", exact: true })
			.click();
		await expect(member).toHaveURL(/\/login$/);
		const anon = page.getByRole("region", { name: "User anonymization" });
		await anon
			.getByRole("button", { name: "Anonymize user", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Anonymize user", exact: true })
			.click();
		await expect(anon.getByRole("alert")).toBeVisible();
		await anon.getByRole("button", { name: "Reload user revision" }).click();
		await anon
			.getByRole("button", { name: "Anonymize user", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Anonymize user", exact: true })
			.click();
		await expect(anon.getByText("User anonymized.")).toBeVisible();
		await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
			"",
		);
		await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
		expect(
			(
				await member.request.post("/_hubuum-bff/auth/login", {
					headers,
					data: { username: name, password, identity_scope: "local" },
				})
			).status(),
		).toBe(401);
	} finally {
		await context.close();
		await page.request
			.delete(`${prefix}/api/v1/iam/users/${user.id}`, { headers })
			.catch(() => undefined);
	}
});
