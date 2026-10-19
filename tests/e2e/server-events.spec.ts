import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const prefix = "/_hubuum-bff/hubuum/api/v1";
const timestamp = "2026-10-19T00:00:00Z";
const sink = {
	id: 7,
	name: "Operations",
	kind: "webhook",
	enabled: true,
	revision: 1,
	config: { destination_url: "https://example.test/hooks/events" },
	created_at: timestamp,
	updated_at: timestamp,
};
const subscription = {
	id: 9,
	name: "Administrator logins",
	description: "",
	enabled: true,
	sink_id: 7,
	entity_types: ["authentication"],
	actions: ["succeeded"],
	filter: {
		subject_is_admin: true,
		task_kinds: ["backup"],
		future_filter: ["keep"],
	},
	routing: {},
	revision: 1,
	created_at: timestamp,
	updated_at: timestamp,
};

async function mockEvents(page: Page, existing = false) {
	let subscriptions = existing ? [subscription] : [];
	const writes: { method: string; body: Record<string, unknown> }[] = [];
	await page.route(`**${prefix}/event-sinks*`, (route) =>
		route.fulfill({ json: [sink] }),
	);
	await page.route(`**${prefix}/event-deliveries*`, (route) =>
		route.fulfill({ json: [] }),
	);
	await page.route(`**${prefix}/event-deliveries/health`, (route) =>
		route.fulfill({
			json: {
				fanout: { pending_events: 0, in_flight_events: 0 },
				delivery: {
					counts: { pending: 0, retryable: 0, dead: 0 },
					oldest_due_age_seconds: 0,
				},
			},
		}),
	);
	await page.route(`**${prefix}/system-event-subscriptions**`, (route) => {
		const method = route.request().method();
		if (method === "GET") return route.fulfill({ json: subscriptions });
		const body = route.request().postDataJSON() ?? {};
		writes.push({ method, body });
		if (method === "DELETE") {
			subscriptions = [];
			return route.fulfill({ status: 204 });
		}
		const saved = { ...subscription, ...body };
		subscriptions = [saved];
		return route.fulfill({
			status: method === "POST" ? 201 : 200,
			json: saved,
		});
	});
	return writes;
}

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe("server event administration", () => {
	test.skip(!process.env.E2E_PASSWORD, "Requires an authenticated session.");
	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		const response = await page.request.post("/_hubuum-bff/auth/login", {
			headers: { Origin: new URL(page.url()).origin },
			data: {
				username: process.env.E2E_USERNAME ?? "admin",
				password: process.env.E2E_PASSWORD,
				identity_scope: "local",
			},
		});
		expect(response.status()).toBe(200);
	});

	test("creates, edits and deletes system subscriptions with subject and task filters", async ({
		page,
	}) => {
		const writes = await mockEvents(page);
		await page.goto("/admin/events");
		await page
			.getByRole("button", { name: "New subscription", exact: true })
			.click();
		const editor = page.locator("form").filter({
			has: page.getByRole("heading", { name: /event subscription/ }),
		});
		await editor
			.getByLabel("Name", { exact: true })
			.fill("Login notifications");
		await editor.getByRole("button", { name: "Continue to events" }).click();
		await editor
			.getByRole("button", { name: "authentication", exact: true })
			.click();
		await editor
			.getByRole("button", { name: "succeeded", exact: true })
			.click();
		await editor.getByRole("button", { name: "Continue to filters" }).click();
		await editor.getByLabel("Subject principal IDs").fill("42, 43");
		await editor.getByLabel("Subject identity scopes").fill("local, company");
		await editor
			.getByLabel("Subject administrator status")
			.selectOption("false");
		await editor.getByLabel("backup", { exact: true }).check();
		await editor.getByRole("button", { name: "Continue to routing" }).click();
		await editor.getByRole("button", { name: "Continue to review" }).click();
		await editor
			.getByRole("button", { name: "Create subscription", exact: true })
			.click();
		await expect(editor).toHaveCount(0);
		expect(writes[0].body.filter).toEqual({
			subject_principal_ids: [42, 43],
			subject_identity_scopes: ["local", "company"],
			subject_is_admin: false,
			task_kinds: ["backup"],
		});
		const row = page
			.getByRole("row")
			.filter({ hasText: "Login notifications" });
		await row.getByRole("button", { name: "Edit", exact: true }).click();
		await editor
			.getByLabel("Name", { exact: true })
			.fill("Renamed notifications");
		await editor.getByRole("tab", { name: /Review/ }).click();
		await editor
			.getByRole("button", { name: "Save subscription", exact: true })
			.click();
		await expect(editor).toHaveCount(0);
		expect(writes[1].body.filter).toEqual(writes[0].body.filter);
		await page
			.getByRole("row")
			.filter({ hasText: "Renamed notifications" })
			.getByRole("button", { name: "Delete", exact: true })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Delete subscription" })
			.click();
		await expect(
			page.getByText("No event subscriptions configured."),
		).toBeVisible();
		await expect(
			page.getByRole("heading", {
				name: "System event subscriptions",
				exact: true,
			}),
		).toBeFocused();
		expect(writes.map((write) => write.method)).toEqual([
			"POST",
			"PATCH",
			"DELETE",
		]);
	});

	test("clears editable filters and retains unknown server filters", async ({
		page,
	}) => {
		const writes = await mockEvents(page, true);
		await page.goto("/admin/events");
		await page
			.getByRole("row")
			.filter({ hasText: "Administrator logins" })
			.getByRole("button", { name: "Edit", exact: true })
			.click();
		const editor = page.locator("form").filter({
			has: page.getByRole("heading", { name: "Edit event subscription" }),
		});
		await editor.getByRole("tab", { name: /Filters/ }).click();
		await editor.getByLabel("Subject administrator status").selectOption("");
		await editor.getByLabel("backup", { exact: true }).uncheck();
		await editor.getByRole("tab", { name: /Review/ }).click();
		await editor
			.getByRole("button", { name: "Save subscription", exact: true })
			.click();
		await expect(editor).toHaveCount(0);
		expect(writes[0].body.filter).toEqual({ future_filter: ["keep"] });
	});

	test("previews locally and queues a test only after explicit confirmation", async ({
		page,
	}) => {
		await mockEvents(page, true);
		const calls: string[] = [];
		let finishTest!: () => void;
		const testPending = new Promise<void>((resolve) => {
			finishTest = resolve;
		});
		await page.route(`**${prefix}/event-sinks/7/*`, async (route) => {
			const path = new URL(route.request().url()).pathname;
			calls.push(path);
			if (path.endsWith("/test")) await testPending;
			expect(route.request().postDataJSON()).toEqual({
				subscription_id: 9,
				event_id: "saved-event-id",
			});
			return route.fulfill({
				status: path.endsWith("/test") ? 202 : 200,
				json: path.endsWith("/test")
					? { id: 41 }
					: {
							payload: { text: "Administrator logged in" },
							sink_kind: "webhook",
						},
			});
		});
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/admin/events");
		const tester = page.getByRole("region", {
			name: "Preview and test notifications",
		});
		await tester.getByLabel("Event sink").selectOption("7");
		await tester.getByLabel("Subscription ID").fill("9");
		await tester.getByLabel("Event ID", { exact: true }).fill("saved-event-id");
		await tester.getByRole("button", { name: "Preview notification" }).click();
		await expect(
			tester.getByRole("region", { name: "Notification preview" }),
		).toContainText("Administrator logged in");
		expect(calls).toHaveLength(1);
		await tester
			.getByRole("button", { name: "Send test notification" })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Cancel", exact: true })
			.click();
		expect(calls).toHaveLength(1);
		await tester
			.getByRole("button", { name: "Send test notification" })
			.click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Send test notification" })
			.click();
		await expect(
			tester.getByRole("button", { name: "Send test notification" }),
		).toBeFocused();
		finishTest();
		await expect(tester.getByRole("status")).toContainText("#41 queued");
		expect(calls).toHaveLength(2);
		expect(
			(
				await new AxeBuilder({ page })
					.include('[aria-label="Preview and test notifications"]')
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze()
			).violations,
		).toEqual([]);
	});

	test("includes direct relations only for audit identity searches", async ({
		page,
	}) => {
		const searches: URLSearchParams[] = [];
		await page.route(`**${prefix}/events?*`, (route) => {
			searches.push(new URL(route.request().url()).searchParams);
			return route.fulfill({ json: [] });
		});
		await page.goto(
			"/audit?entityType=object&entityId=42&includeRelations=true",
		);
		await expect
			.poll(() =>
				searches.some(
					(params) =>
						params.get("entity_id") === "42" &&
						params.get("include_relations") === "true",
				),
			)
			.toBe(true);
		await page
			.getByRole("checkbox", {
				name: "Include direct relation activity",
				exact: true,
			})
			.uncheck();
		await page.getByRole("button", { name: "Apply filters" }).click();
		await expect
			.poll(() => searches.at(-1)?.has("include_relations"))
			.toBe(false);
	});
	test("manages a disabled login subscription through the live BFF", async ({
		page,
	}) => {
		test.setTimeout(60_000);
		const headers = { Origin: new URL(page.url()).origin };
		const name = `login-test-${Date.now()}`;
		const createdSink = await page.request.post(`${prefix}/event-sinks`, {
			headers,
			data: { name, kind: "webhook", config: {}, enabled: false },
		});
		expect(createdSink.status()).toBe(201);
		const sinkResponse = await page.request.get(`${prefix}/event-sinks`);
		const sinkRecords: { id: number; name: string }[] =
			await sinkResponse.json();
		const sinkId = sinkRecords.find((sink) => sink.name === name)?.id;
		expect(sinkId).toBeDefined();
		let subscriptionId: number | undefined;
		try {
			await page.goto("/admin/events");
			await page
				.getByRole("button", { name: "New subscription", exact: true })
				.click();
			const editor = page.locator("form").filter({
				has: page.getByRole("heading", { name: "Create event subscription" }),
			});
			await editor.getByLabel("Name", { exact: true }).fill(name);
			await editor
				.getByRole("combobox", { name: "Event sink", exact: true })
				.selectOption(String(sinkId));
			await editor.getByLabel("Enable immediately", { exact: true }).uncheck();
			await editor.getByRole("button", { name: "Continue to events" }).click();
			await editor
				.getByRole("button", { name: "authentication", exact: true })
				.click();
			await editor
				.getByRole("button", { name: "succeeded", exact: true })
				.click();
			await editor.getByRole("button", { name: "Continue to filters" }).click();
			await editor
				.getByLabel("Subject administrator status")
				.selectOption("true");
			await editor.getByRole("button", { name: "Continue to routing" }).click();
			await editor
				.getByLabel("Webhook URL", { exact: true })
				.fill("https://example.test/never-sent");
			await editor.getByRole("button", { name: "Continue to review" }).click();
			await editor
				.getByRole("button", { name: "Create subscription", exact: true })
				.click();
			await expect(editor).toHaveCount(0);
			const response = await page.request.get(
				`${prefix}/system-event-subscriptions`,
			);
			expect(response.status()).toBe(200);
			const records: {
				id: number;
				name: string;
				enabled: boolean;
				filter: unknown;
			}[] = await response.json();
			const saved = records.find((item) => item.name === name);
			expect(saved).toMatchObject({
				enabled: false,
				filter: { subject_is_admin: true },
			});
			subscriptionId = saved?.id;
			const row = page
				.getByRole("article")
				.filter({
					has: page.getByRole("heading", {
						name: "System event subscriptions",
					}),
				})
				.getByRole("row")
				.filter({ hasText: name });
			await row.getByRole("button", { name: "Delete", exact: true }).click();
			await page
				.getByRole("alertdialog")
				.getByRole("button", { name: "Delete subscription" })
				.click();
			await expect(row).toHaveCount(0);
		} finally {
			if (subscriptionId !== undefined)
				await page.request.delete(
					`${prefix}/system-event-subscriptions/${subscriptionId}`,
					{ headers },
				);
			await page.request
				.delete(`${prefix}/event-sinks/${sinkId}`, { headers })
				.catch(() => undefined);
		}
	});
});
