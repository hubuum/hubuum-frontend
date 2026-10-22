import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type {
	CredentialActivityResponse,
	MeResponse,
	PrincipalTokenMetadata,
} from "../../src/lib/api/generated/models";

const prefix = "/_hubuum-bff/hubuum/api/v1";
const timestamp = "2026-10-22T10:00:00Z";
const tokens: PrincipalTokenMetadata[] = [901, 902].map((id) => ({
	id,
	principal_id: 1,
	name: `activity-token-${id}`,
	issued: timestamp,
	active: true,
	expired: false,
	revision: 1,
	scope: null,
}));
const evidence: CredentialActivityResponse = {
	creation: {
		issuer_id: 7,
		issuance_method: "creation",
		issued_at: timestamp,
		address: "192.0.2.1",
		address_method: "connection_peer",
	},
	session_id: "37cdfe1b-4d50-4f47-bb39-f850fe64cd83",
	sources: [
		{
			address: "2001:db8:1234:5678:90ab:cdef:1234:5678",
			address_method: "connection_peer",
			first_seen: timestamp,
			last_seen: timestamp,
		},
		{
			address: "2001:db8:1234:5678:90ab:cdef:1234:5678",
			address_method: "trusted_forwarded",
			first_seen: timestamp,
			last_seen: timestamp,
		},
	],
	offset: 0,
	limit: 50,
	total: 3,
	next_offset: 2,
	collection_enabled: false,
	best_effort: true,
	retention_days: 30,
	source_cap: 32,
	overflow_since: timestamp,
};
const emptyEvidence: CredentialActivityResponse = {
	...evidence,
	creation: null,
	session_id: null,
	sources: [],
	total: 0,
	next_offset: null,
	overflow_since: null,
	collection_enabled: true,
};

test.use({ trace: "off", screenshot: "off", video: "off" });
test.beforeEach(async ({ page }) => {
	test.skip(
		!process.env.E2E_PASSWORD,
		"Requires disposable authenticated server",
	);
	await page.goto("/login");
	const login = await page.request.post("/_hubuum-bff/auth/login", {
		headers: { Origin: new URL(page.url()).origin },
		data: {
			username: process.env.E2E_USERNAME ?? "admin",
			password: process.env.E2E_PASSWORD,
			identity_scope: "local",
		},
	});
	expect(login.status()).toBe(200);
});

async function fixtureTokens(page: Page) {
	await page.route(`**${prefix}/iam/me/tokens?*`, (route) =>
		route.fulfill({ json: tokens }),
	);
	await page.goto("/account/tokens");
	await expect(
		page.getByRole("row", { name: /View details for token 901/ }),
	).toBeVisible();
}

test("credential activity loads lazily, pages sources and resets when changing tokens", async ({
	page,
}) => {
	const requests: string[] = [];
	await page.route(
		`**${prefix}/iam/principals/1/tokens/*/activity?*`,
		(route) => {
			const url = new URL(route.request().url());
			const id = url.pathname.split("/").at(-2);
			const offset = Number(url.searchParams.get("offset"));
			expect(url.searchParams.get("limit")).toBe("50");
			requests.push(`${id}:${offset}`);
			return route.fulfill({
				json:
					id === "902"
						? emptyEvidence
						: offset === 0
							? evidence
							: {
									...evidence,
									offset,
									next_offset: null,
									sources: [
										{
											address: null,
											address_method: "unavailable",
											first_seen: timestamp,
											last_seen: timestamp,
										},
									],
								},
			});
		},
	);
	await fixtureTokens(page);
	expect(requests).toEqual([]);
	await page
		.getByRole("row", { name: /View details for token 901/ })
		.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Token #901" });
	const activity = dialog.getByRole("region", { name: "Credential activity" });
	await expect(
		activity.getByText("Principal #7", { exact: true }),
	).toBeVisible();
	await expect(activity.getByText("192.0.2.1", { exact: true })).toBeVisible();
	await expect(
		activity.getByText(evidence.session_id ?? "", { exact: true }),
	).toBeVisible();
	await expect(
		activity.getByText(/shared across this session's rotating access tokens/),
	).toBeVisible();
	await expect(activity.getByText(/Collection is disabled/)).toBeVisible();
	await expect(activity.getByText(/best-effort basis/)).toBeVisible();
	await expect(
		activity.getByText(/At least one source was omitted/),
	).toBeVisible();
	const sources = activity.getByRole("table", {
		name: "Recent credential sources",
	});
	await expect(sources.getByRole("row")).toHaveCount(3);
	await expect(
		sources.getByRole("cell", {
			name: "Trusted forwarded address",
			exact: true,
		}),
	).toBeVisible();

	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 900 });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(value) => document.documentElement.setAttribute("data-theme", value),
				theme,
			);
			await page.evaluate(async () => {
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
				await Promise.all(
					document
						.getAnimations()
						.map((animation) => animation.finished.catch(() => undefined)),
				);
			});
			expect(
				(
					await new AxeBuilder({ page })
						.include('[role="dialog"]')
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze()
				).violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
		}
	}
	await activity.getByRole("region", { name: "Recent sources table" }).focus();
	await expect(
		activity.getByRole("region", { name: "Recent sources table" }),
	).toBeFocused();
	await page.keyboard.press("ArrowRight");
	await expect(dialog).toBeVisible();
	await activity
		.getByRole("button", { name: "Next page", exact: true })
		.click();
	await expect(
		activity.getByRole("cell", { name: "Unavailable", exact: true }),
	).toHaveCount(2);
	await expect(
		activity.getByRole("button", { name: "Next page", exact: true }),
	).toHaveCount(0);
	await activity
		.getByRole("button", { name: "Previous page", exact: true })
		.click();
	await expect(sources.getByRole("row")).toHaveCount(3);
	await activity
		.getByRole("button", { name: "Next page", exact: true })
		.click();
	await expect(
		activity.getByRole("cell", { name: "Unavailable", exact: true }),
	).toHaveCount(2);
	await dialog.getByRole("button", { name: "Next token", exact: true }).click();
	const other = page.getByRole("dialog", { name: "Token #902" });
	await expect(
		other.getByText(/Creation provenance was not recorded/),
	).toBeVisible();
	await expect(
		other.getByText(/does not establish that the credential was unused/),
	).toBeVisible();
	await expect(other.getByText("Principal #7", { exact: true })).toHaveCount(0);
	await expect(
		other.getByRole("button", { name: "Previous page", exact: true }),
	).toHaveCount(0);
	await other
		.getByRole("button", { name: "Previous token", exact: true })
		.click();
	await expect(sources.getByRole("row")).toHaveCount(3);
	const beforeRefresh = requests.length;
	await activity
		.getByRole("button", { name: "Refresh activity", exact: true })
		.click();
	await expect(
		activity.getByRole("button", { name: "Refresh activity", exact: true }),
	).toBeEnabled();
	await expect.poll(() => requests.length).toBeGreaterThan(beforeRefresh);
	// Development Strict Mode can abort and replay a mounted query.
	expect(
		requests.filter((request, index) => request !== requests[index - 1]),
	).toEqual(["901:0", "901:2", "901:0", "901:2", "902:0", "901:0"]);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();
	await expect(
		page.getByRole("row", { name: /View details for token 901/ }),
	).toBeFocused();
});

test("credential activity keeps a delayed response isolated when changing tokens", async ({
	page,
}) => {
	let releaseFirst = () => {};
	const firstPending = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let firstRequests = 0;
	await page.route(
		`**${prefix}/iam/principals/1/tokens/*/activity?*`,
		async (route) => {
			const isFirst = new URL(route.request().url()).pathname.includes("/901/");
			if (isFirst) {
				firstRequests++;
				await firstPending;
			}
			await route.fulfill({
				json: isFirst
					? evidence
					: {
							...emptyEvidence,
							creation: {
								issuer_id: null,
								issuance_method: "future-method",
								issued_at: timestamp,
								address: null,
								address_method: "unavailable",
							},
						},
			});
		},
	);
	try {
		await fixtureTokens(page);
		await page.getByRole("row", { name: /View details for token 901/ }).click();
		const first = page.getByRole("dialog", { name: "Token #901" });
		await expect(first.getByRole("status")).toHaveText(
			"Loading credential activity…",
		);
		await expect(
			first.getByRole("button", { name: "Refresh activity" }),
		).toBeDisabled();
		await first
			.getByRole("button", { name: "Next token", exact: true })
			.click();
		const other = page.getByRole("dialog", { name: "Token #902" });
		await expect(other.getByText("Unknown", { exact: true })).toBeVisible();
		await expect(
			other.getByText("future-method", { exact: true }),
		).toBeVisible();
		releaseFirst();
		await expect(other.getByText("Principal #7", { exact: true })).toHaveCount(
			0,
		);
		const beforeReturning = firstRequests;
		await other
			.getByRole("button", { name: "Previous token", exact: true })
			.click();
		await expect(
			first.getByText("Principal #7", { exact: true }),
		).toBeVisible();
		expect(firstRequests).toBeGreaterThan(beforeReturning);
	} finally {
		releaseFirst();
	}
});

for (const status of [403, 404, 500]) {
	test(`credential activity ${status} errors preserve token details and support retry`, async ({
		page,
	}) => {
		let requests = 0;
		let recovered = false;
		await page.route(
			`**${prefix}/iam/principals/1/tokens/901/activity?*`,
			(route) => {
				requests += 1;
				return !recovered
					? route.fulfill({
							status,
							json: { message: "Activity request rejected" },
						})
					: route.fulfill({ json: emptyEvidence });
			},
		);
		await fixtureTokens(page);
		await page.getByRole("row", { name: /View details for token 901/ }).click();
		const dialog = page.getByRole("dialog", { name: "Token #901" });
		await expect(dialog.getByRole("alert")).toContainText(
			status === 404 ? "may have been removed" : "Activity request rejected",
		);
		await expect(
			dialog.getByRole("heading", { name: "Token boundaries" }),
		).toBeVisible();
		await expect(
			dialog.getByText(/does not establish that the credential was unused/),
		).toHaveCount(0);
		recovered = true;
		await dialog.getByRole("button", { name: "Retry activity" }).click();
		await expect(
			dialog.getByText(/Creation provenance was not recorded/),
		).toBeVisible();
		await expect(dialog.getByRole("alert")).toHaveCount(0);
		expect(requests).toBeGreaterThanOrEqual(2);
	});
}

test("credential activity from the live server shows the current session's provenance", async ({
	page,
}) => {
	const response = await page.request.get(`${prefix}/iam/me`);
	expect(response.status()).toBe(200);
	const me = await response.json();
	await page.goto("/account/tokens");
	await expect(
		page.getByRole("region", { name: "Current web session", exact: true }),
	).toContainText(`#${me.token.id}`);
	await expect(
		page
			.getByRole("row", {
				name: new RegExp(`View details for token ${me.token.id}(?: |$)`),
			})
			.getByText("Current web session", { exact: true }),
	).toBeVisible();
	const activityResponse = page.waitForResponse(
		(result) =>
			new URL(result.url()).pathname ===
			`${prefix}/iam/principals/${me.principal.principal_id}/tokens/${me.token.id}/activity`,
	);
	await page
		.getByRole("row", {
			name: new RegExp(`View details for token ${me.token.id}(?: |$)`),
		})
		.click();
	const result = await activityResponse;
	expect(result.status()).toBe(200);
	const data = await result.json();
	expect(data.creation.issuer_id).toBe(me.principal.principal_id);
	expect(data.creation.issuance_method).toBe("login");
	expect(data.session_id).toBeTruthy();
	const dialog = page.getByRole("dialog", { name: `Token #${me.token.id}` });
	await expect(
		dialog.getByText(`Principal #${data.creation.issuer_id}`, { exact: true }),
	).toBeVisible();
	await expect(
		dialog.getByText(data.session_id, { exact: true }),
	).toBeVisible();
	await expect(dialog.getByText("login", { exact: true })).toBeVisible();
});

test("token overview pins the current session across pages, filters and rotations", async ({
	page,
}) => {
	await page.clock.install();
	const response = await page.request.get(`${prefix}/iam/me`);
	const me: MeResponse = await response.json();
	let currentId = 903;
	const requests: URL[] = [];
	await page.route(`**${prefix}/iam/me`, (route) =>
		route.fulfill({ json: { ...me, token: { ...me.token, id: currentId } } }),
	);
	await page.route(`**${prefix}/iam/me/tokens?*`, (route) => {
		const url = new URL(route.request().url());
		requests.push(url);
		const state = url.searchParams.get("state");
		return route.fulfill({
			json:
				state === "active"
					? url.searchParams.has("cursor")
						? [{ ...tokens[0], id: currentId, name: null }]
						: tokens
					: [{ ...tokens[0], active: false, expired: true, expires_at: null }],
			headers: {
				"X-Total-Count": state === "active" ? "27" : "1",
				...(state === "active" && !url.searchParams.has("cursor")
					? { "X-Next-Cursor": "opaque+cursor=" }
					: {}),
			},
		});
	});
	await page.route(
		`**${prefix}/iam/principals/*/tokens/*/activity?*`,
		(route) => route.fulfill({ json: evidence }),
	);
	await page.goto("/account/tokens");
	const current = page.getByRole("region", {
		name: "Current web session",
		exact: true,
	});
	await expect(
		current.getByRole("button", { name: "Inspect current token #903" }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Active tokens (27)" }),
	).toBeVisible();
	await expect(
		page.getByText("Showing 2 of 27", { exact: true }),
	).toBeVisible();
	expect(requests[0].searchParams.get("limit")).toBe("25");
	expect(requests[0].searchParams.get("sort")).toBe("-issued_at");
	await current.getByRole("button").click();
	await expect(page.getByRole("dialog", { name: "Token #903" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(current.getByRole("button")).toBeFocused();
	await page.getByRole("button", { name: "Next page", exact: true }).click();
	const row = page.getByRole("row", {
		name: "View details for token 903",
		exact: true,
	});
	await expect(
		row.getByText("Current web session", { exact: true }),
	).toBeVisible();
	expect(requests.at(-1)?.searchParams.get("cursor")).toBe("opaque+cursor=");
	await page
		.getByRole("button", { name: "Previous page", exact: true })
		.click();
	await expect(
		page.getByRole("row", { name: /View details for token 901/ }),
	).toBeVisible();
	await page.getByRole("button", { name: "Next page", exact: true }).click();
	await expect(row).toBeVisible();
	await page
		.getByRole("combobox", { name: "Token state", exact: true })
		.selectOption("expired");
	await expect(
		page.getByRole("heading", { name: "Expired tokens (1)" }),
	).toBeVisible();
	await expect(
		page.getByRole("cell", { name: "Expired", exact: true }),
	).toBeVisible();
	expect(requests.at(-1)?.searchParams.has("cursor")).toBe(false);
	await expect(current).toContainText("#903");
	await page
		.getByRole("combobox", { name: "Token order", exact: true })
		.selectOption("-last_used_at");
	await expect
		.poll(() => requests.at(-1)?.searchParams.get("sort"))
		.toBe("-last_used_at");
	currentId = 904;
	await page
		.getByRole("button", { name: "Refresh overview", exact: true })
		.click();
	await expect(
		current.getByRole("button", { name: "Inspect current token #904" }),
	).toBeVisible();
	await current.getByRole("button").click();
	await expect(page.getByRole("dialog", { name: "Token #904" })).toBeVisible();
	await page.keyboard.press("Escape");
	// Polling updates metadata even if the user leaves this overview open.
	currentId = 905;
	await page.clock.fastForward(30_000);
	await expect(
		current.getByRole("button", { name: "Inspect current token #905" }),
	).toBeVisible();
});

test("token overview loads bounded optional activity and preserves unavailable evidence", async ({
	page,
}) => {
	let summaryRequests = 0;
	await page.route(
		`**${prefix}/iam/principals/1/tokens/*/activity?*`,
		(route) => {
			const url = new URL(route.request().url());
			expect(url.searchParams.get("limit")).toBe("1");
			summaryRequests++;
			return route.fulfill(
				url.pathname.includes("/902/")
					? { status: 403, json: { message: "Denied" } }
					: {
							json: {
								...evidence,
								limit: 1,
								sources: evidence.sources.slice(0, 1),
							},
						},
			);
		},
	);
	await fixtureTokens(page);
	expect(summaryRequests).toBe(0);
	await page.getByRole("checkbox", { name: "Show activity overview" }).check();
	const row = page.getByRole("row", { name: /View details for token 901/ });
	await expect(row).toContainText("Session token");
	await expect(row).toContainText("creation · Issuer #7");
	await expect(row).toContainText("192.0.2.1 · connection peer");
	await expect(row).toContainText("3 recorded sources");
	await expect(row).toContainText("Collection disabled");
	await expect(row).toContainText("history incomplete");
	await expect(
		page.getByRole("row", { name: /View details for token 902/ }),
	).toContainText("Activity unavailable");
	const beforeRefresh = summaryRequests;
	await page
		.getByRole("button", { name: "Refresh overview", exact: true })
		.click();
	await expect.poll(() => summaryRequests).toBeGreaterThan(beforeRefresh);
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: 1000 });
		for (const theme of ["light", "dark"]) {
			await page.evaluate(
				(value) => document.documentElement.setAttribute("data-theme", value),
				theme,
			);
			await page.evaluate(async () => {
				await new Promise<void>((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
				);
				await Promise.all(
					document
						.getAnimations()
						.map((animation) => animation.finished.catch(() => undefined)),
				);
			});
			expect(
				(
					await new AxeBuilder({ page })
						.include("main")
						.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
						.analyze()
				).violations,
			).toEqual([]);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= window.innerWidth,
				),
			).toBe(true);
		}
	}
	await page.getByRole("region", { name: "Token overview table" }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page.getByRole("dialog", { name: /^Token #/ })).toHaveCount(0);
});
