import {
	expect,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

const mode = process.env.E2E_CREDENTIAL_APPROVALS;
const prefix = "/_hubuum-bff/hubuum";
test.use({ trace: "off", screenshot: "off", video: "off" });

test.describe("live credential compatibility", () => {
	// Explicit opt-in: these tests create disposable credentials and may restore data.
	test.skip(
		!mode || !process.env.E2E_PASSWORD,
		"Requires an explicitly selected disposable credential test stack.",
	);
	test.describe.configure({ mode: "serial" });
	test.afterEach(async ({ page }) => {
		// Avoid Playwright's failure-context DOM snapshot retaining issued credentials.
		await page.close();
	});

	async function login(page: Page) {
		await page.goto("/login");
		const origin = new URL(page.url()).origin;
		const response = await page.request.post("/_hubuum-bff/auth/login", {
			headers: { Origin: origin },
			data: {
				username: process.env.E2E_USERNAME ?? "admin",
				password: process.env.E2E_PASSWORD,
				identity_scope: "local",
			},
		});
		expect(response.status()).toBe(200);
		return origin;
	}

	async function mutate(
		request: APIRequestContext,
		origin: string,
		path: string,
		method: "POST" | "PATCH",
		body: unknown,
		expected: number,
		headers: Record<string, string> = {},
	) {
		let response = await request.fetch(`${prefix}${path}`, {
			method,
			headers: { Origin: origin, ...headers },
			data: body,
		});
		if (mode === "required") {
			expect(response.status()).toBe(403);
			expect((await response.json()).reason).toBe("reauthentication_required");
			response = await request.post("/_hubuum-bff/credential-mutations", {
				headers: { Origin: origin },
				data: {
					password: process.env.E2E_PASSWORD,
					path,
					method,
					body,
					ifMatch: headers["If-Match"] ?? null,
					idempotencyKey: headers["Idempotency-Key"] ?? null,
				},
			});
		}
		expect(response.status()).toBe(expected);
		expect(response.headers()["x-hubuum-credential-approval"]).toBeUndefined();
		expect(response.headers()["cache-control"]).toContain("no-store");
		return response;
	}

	test("token creation works through the real form, including nested password confirmation", async ({
		page,
	}) => {
		await login(page);
		await page.goto("/account/tokens");
		await page.getByRole("button", { name: "Create new", exact: true }).click();
		const create = page.getByRole("dialog", {
			name: "Create token",
			exact: true,
		});
		await create
			.getByLabel("Name (optional)")
			.fill(`approval-ui-${Date.now()}`);
		await create
			.getByRole("button", { name: /Continue to Permission scope/i })
			.click();
		await create
			.getByRole("button", { name: /Continue to Resource scope/i })
			.click();
		await create.getByRole("button", { name: /^All resources/ }).click();
		await create.getByRole("button", { name: /Continue to Review/i }).click();
		await create
			.getByRole("button", { name: "Create token", exact: true })
			.click();
		const confirmation = page.getByRole("dialog", {
			name: "Confirm your password",
		});
		if (mode === "required") {
			await expect(
				confirmation.getByLabel("Your current password"),
			).toBeFocused();
			await confirmation
				.getByLabel("Your current password")
				.fill("incorrect-test-password");
			await confirmation
				.getByRole("button", { name: "Confirm operation" })
				.click();
			await expect(confirmation.getByRole("alert")).toContainText(
				"not accepted",
			);
			await expect(
				confirmation.getByLabel("Your current password"),
			).toHaveValue("");
			expect((await page.request.get(`${prefix}/api/v1/iam/me`)).status()).toBe(
				200,
			);
			await confirmation
				.getByLabel("Your current password")
				.fill(process.env.E2E_PASSWORD ?? "");
			await confirmation
				.getByRole("button", { name: "Confirm operation" })
				.click();
		}
		await expect(
			create.getByRole("heading", { name: "Token created" }),
		).toBeVisible();
		await expect(confirmation).toHaveCount(0);
		await create.getByRole("button", { name: "Done", exact: true }).click();
	});

	test("user creation, password updates, minting, renewal, and credential imports remain compatible", async ({
		page,
	}) => {
		const origin = await login(page);
		const request = page.request;
		const suffix = Date.now();
		const groupResponse = await request.post(`${prefix}/api/v1/iam/groups`, {
			headers: { Origin: origin },
			data: {
				groupname: `approval-owner-${suffix}`,
				description: "Credential test owner",
			},
		});
		expect(groupResponse.status()).toBe(201);
		const group = await groupResponse.json();
		const accountResponse = await request.post(
			`${prefix}/api/v1/iam/service-accounts`,
			{
				headers: { Origin: origin },
				data: { name: `approval-service-${suffix}`, owner_group_id: group.id },
			},
		);
		expect(accountResponse.status()).toBe(201);
		const account = await accountResponse.json();
		await mutate(
			request,
			origin,
			`/api/v1/iam/principals/${account.id}/tokens`,
			"POST",
			{ name: "initial", scope: { permissions: ["ReadObject"] } },
			201,
		);
		const user = await (
			await mutate(
				request,
				origin,
				"/api/v1/iam/users",
				"POST",
				{
					name: `approval-user-${suffix}`,
					password: `Test-${crypto.randomUUID()}`,
				},
				201,
			)
		).json();
		const existing = await request.get(`${prefix}/api/v1/iam/users/${user.id}`);
		await mutate(
			request,
			origin,
			`/api/v1/iam/users/${user.id}`,
			"PATCH",
			{ password: `Changed-${crypto.randomUUID()}` },
			200,
			{ "If-Match": existing.headers().etag },
		);
		const expires_at = `${new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19)}.123456789`;
		const tokenResponse = await mutate(
			request,
			origin,
			`/api/v1/iam/principals/${user.id}/tokens`,
			"POST",
			{ name: `approval-token-${suffix}`, expires_at },
			201,
		);
		const issued = await tokenResponse.json();
		expect(typeof issued.token).toBe("string");
		if (mode === "required")
			expect(issued.expires_at).toBe(expires_at.slice(0, -3));
		const tokens = await (
			await request.get(
				`${prefix}/api/v1/iam/principals/${user.id}/tokens?include_total=false`,
			)
		).json();
		const token = tokens.find(
			(item: { name: string }) => item.name === `approval-token-${suffix}`,
		);
		expect(token).toBeTruthy();
		await mutate(
			request,
			origin,
			`/api/v1/iam/principals/${user.id}/tokens/${token.id}/renew`,
			"POST",
			{},
			201,
		);
		for (const dry_run of [true, false]) {
			const body = {
				version: 2,
				dry_run,
				graph: {
					principals: [
						{
							kind: "human",
							name: `approval-import-${suffix}`,
							provider_managed: false,
							identity_scope_key: { name: "local" },
							password: `Import-${suffix}`,
						},
					],
				},
			};
			const headers = { "Idempotency-Key": `approval-${suffix}-${dry_run}` };
			const task = await (
				await mutate(
					request,
					origin,
					"/api/v1/imports",
					"POST",
					body,
					202,
					headers,
				)
			).json();
			// A replay must return the same admission even after the first approval was consumed.
			const replay = await (
				await mutate(
					request,
					origin,
					"/api/v1/imports",
					"POST",
					body,
					202,
					headers,
				)
			).json();
			expect(replay.id).toBe(task.id);
			await expect
				.poll(
					async () =>
						(
							await (
								await request.get(`${prefix}/api/v1/tasks/${task.id}`)
							).json()
						).status,
					{ timeout: 60_000 },
				)
				.toBe("succeeded");
		}
	});

	test("restore confirmation retains capability polling after fresh authentication", async ({
		page,
	}) => {
		test.skip(
			process.env.E2E_CREDENTIAL_RESTORE !== "1",
			"Restore is only enabled for an explicitly disposable stack.",
		);
		test.setTimeout(120_000);
		const origin = await login(page);
		const request = page.request;
		const backupResponse = await request.post(`${prefix}/api/v1/backups`, {
			headers: { Origin: origin },
			data: { include_history: false },
		});
		expect(backupResponse.status()).toBe(202);
		const backup = await backupResponse.json();
		await expect
			.poll(
				async () =>
					(
						await (
							await request.get(`${prefix}/api/v1/backups/${backup.id}`)
						).json()
					).status,
				{ timeout: 60_000 },
			)
			.toBe("succeeded");
		const output = await (
			await request.get(`${prefix}/api/v1/backups/${backup.id}/output`)
		).body();
		const stageResponse = await request.post(`${prefix}/api/v1/restores`, {
			headers: { Origin: origin, "Content-Type": "application/json" },
			data: output,
		});
		expect(stageResponse.status()).toBe(201);
		const stage = await stageResponse.json();
		await mutate(
			request,
			origin,
			`/api/v1/restores/${stage.id}/confirm`,
			"POST",
			{
				restore_capability: stage.restore_capability,
				sha256: stage.sha256,
				confirmation: "REPLACE ALL HUBUUM DATA",
			},
			202,
		);
		await expect
			.poll(
				async () => {
					const response = await request.get(
						`${prefix}/api/v1/restores/${stage.id}/status`,
						{
							headers: {
								"X-Hubuum-Restore-Capability": stage.restore_capability,
							},
						},
					);
					return response.ok()
						? (await response.json()).status
						: `HTTP ${response.status()}`;
				},
				{ timeout: 90_000 },
			)
			.toBe("succeeded");
	});
});
