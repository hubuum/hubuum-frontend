import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const prefix = "/_hubuum-bff/hubuum";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("delegated collection manager creates a webhook and subscription without global sink discovery", async ({
	page,
	browser,
}) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires a disposable server with collection sink support.",
	);
	await page.goto("/login");
	const origin = new URL(page.url()).origin;
	const headers = { Origin: origin };
	expect(
		(
			await page.request.post("/_hubuum-bff/auth/login", {
				headers,
				data: {
					username: process.env.E2E_USERNAME ?? "admin",
					password: process.env.E2E_PASSWORD,
					identity_scope: "local",
				},
			})
		).status(),
	).toBe(200);
	const suffix = randomUUID();
	const groupResponse = await page.request.post(`${prefix}/api/v1/iam/groups`, {
		headers,
		data: {
			groupname: `webhook-${suffix}`,
			description: "Delegated webhook test",
		},
	});
	expect(groupResponse.status()).toBe(201);
	const group = await groupResponse.json();
	const userPassword = randomUUID();
	const userBody = {
		name: `webhook-${suffix}`,
		password: userPassword,
		email: "webhook@example.test",
		proper_name: "Webhook manager",
	};
	let userResponse = await page.request.post(`${prefix}/api/v1/iam/users`, {
		headers,
		data: userBody,
	});
	if (
		userResponse.status() === 403 &&
		(await userResponse.json()).reason === "reauthentication_required"
	) {
		userResponse = await page.request.post(
			"/_hubuum-bff/credential-mutations",
			{
				headers,
				data: {
					password: process.env.E2E_PASSWORD,
					path: "/api/v1/iam/users",
					method: "POST",
					body: userBody,
					ifMatch: null,
					idempotencyKey: null,
				},
			},
		);
	}
	expect(userResponse.status()).toBe(201);
	const user = await userResponse.json();
	let collectionId: number | undefined;
	const delegated = await browser.newContext({ baseURL: origin });
	try {
		expect(
			(
				await page.request.post(
					`${prefix}/api/v1/iam/groups/${group.id}/members/${user.id}`,
					{ headers },
				)
			).status(),
		).toBe(201);
		const created = await page.request.post(`${prefix}/api/v1/collections`, {
			headers,
			data: {
				name: `webhook-${suffix}`,
				description: "Self-service test",
				group_id: group.id,
			},
		});
		expect(created.status()).toBe(201);
		collectionId = (await created.json()).id;
		expect(
			(
				await delegated.request.post("/_hubuum-bff/auth/login", {
					headers,
					data: {
						username: user.name,
						password: userPassword,
						identity_scope: "local",
					},
				})
			).status(),
		).toBe(200);
		expect(
			(await delegated.request.get(`${prefix}/api/v1/event-sinks`)).status(),
		).toBe(403);
		const manager = await delegated.newPage();
		const globalDiscovery: string[] = [];
		manager.on("request", (request) => {
			if (new URL(request.url()).pathname === `${prefix}/api/v1/event-sinks`)
				globalDiscovery.push(request.method());
		});
		await manager.goto(`/collections/${collectionId}`);
		await manager
			.getByRole("button", { name: "New webhook destination" })
			.click();
		const form = manager.getByRole("form", {
			name: "Collection webhook destination",
		});
		await form.getByLabel("Destination name").fill(`notifications-${suffix}`);
		await form.getByLabel("Webhook target").selectOption("slack");
		await form
			.getByLabel("Destination URL", { exact: true })
			.fill("https://example.test/hooks/delegated");
		await form.getByRole("button", { name: "Save destination" }).click();
		await expect(form).toHaveCount(0);
		await manager
			.getByRole("button", { name: "New subscription", exact: true })
			.click();
		const editor = manager.locator("form").filter({
			has: manager.getByRole("heading", {
				name: "Create event subscription",
			}),
		});
		await editor.getByLabel("Name", { exact: true }).fill(`changes-${suffix}`);
		const destinations = await delegated.request.get(
			`${prefix}/api/v1/collections/${collectionId}/event-sinks`,
		);
		expect(destinations.status()).toBe(200);
		const sinks: { id: number; name: string }[] = await destinations.json();
		const destination = sinks.find(
			(sink) => sink.name === `notifications-${suffix}`,
		);
		expect(destination).toBeDefined();
		await editor
			.getByRole("combobox", { name: "Event sink", exact: true })
			.selectOption(String(destination?.id));
		await editor.getByRole("button", { name: "Continue to events" }).click();
		await editor.getByRole("button", { name: "object", exact: true }).click();
		await editor.getByRole("button", { name: "updated", exact: true }).click();
		await editor.getByRole("button", { name: "Continue to filters" }).click();
		await editor.getByRole("button", { name: "Continue to routing" }).click();
		await expect(editor).toContainText("No subscription URL is needed");
		await editor.getByRole("button", { name: "Continue to review" }).click();
		const saved = manager.waitForResponse(
			(response) =>
				response
					.url()
					.endsWith(`/collections/${collectionId}/event-subscriptions`) &&
				response.request().method() === "POST",
		);
		await editor
			.getByRole("button", { name: "Create subscription", exact: true })
			.click();
		expect((await saved).status()).toBe(201);
		expect(globalDiscovery).toEqual([]);
	} finally {
		await delegated.close();
		if (collectionId !== undefined)
			await page.request.delete(
				`${prefix}/api/v1/collections/${collectionId}`,
				{ headers },
			);
		await page.request.delete(`${prefix}/api/v1/iam/users/${user.id}`, {
			headers,
		});
		await page.request.delete(`${prefix}/api/v1/iam/groups/${group.id}`, {
			headers,
		});
	}
});
