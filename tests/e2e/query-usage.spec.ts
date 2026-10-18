import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type {
	QueryUsageAnalysisResponse,
	QueryUsagePatternSchema,
	QueryUsageResponse,
} from "../../src/lib/api/generated/models";

const timestamp = "2026-10-18T10:00:00Z";
const apiPath = "/_hubuum-bff/hubuum/api/v1/classes/10/query-usage";
const pattern: QueryUsagePatternSchema = {
	path: "hardware,serial_number",
	value_type: "string",
	operations: ["equals"],
};
const declaration: QueryUsageResponse = {
	id: 17,
	class_id: 10,
	revision: 3,
	pattern,
	schema_compatibility: "compatible",
	created_at: timestamp,
	updated_at: timestamp,
	created_by: 1,
	updated_by: 1,
};

function analysisReport(): QueryUsageAnalysisResponse {
	const observation = {
		pattern: { ...pattern, path: "hostname" },
		sampled_queries: 8,
		whole_query_duration_micros: 12000,
		first_observed_at: timestamp,
		last_observed_at: timestamp,
	};
	return {
		status: "complete",
		assessed_at: timestamp,
		limitations: ["Native scans cover multiple classes."],
		observations: {
			source: "process-local",
			process_started_at: timestamp,
			captured_at: timestamp,
			capacity_drops: 2,
			patterns: [observation],
			settings: {
				enabled: true,
				sample_every: 16,
				max_patterns: 2048,
				max_patterns_per_class: 64,
				max_predicates_per_query: 16,
				retention_seconds: 86400,
			},
		},
		suggestions: [
			{
				proposed: observation.pattern,
				rationale: "Eight successful sampled text equality queries.",
				observations: [observation],
			},
		],
		assessments: [
			{
				declaration_id: 17,
				pattern,
				schema_compatibility: "compatible",
				can_prepare: true,
				rationale: "Matching native expression index.",
				adapter_progress: {
					reference: "resource-17",
					state: "pending_cleanup",
					declaration_owners: 2,
					last_error: "Lock budget exceeded",
					updated_at: timestamp,
				},
				resources: [
					{
						reference: "query_usage_index_17",
						ownership: "declaration_managed",
						bytes: 8192,
						native_scan_count: 0,
						declaration_owners: 2,
						cleanup_eligible_if_removed: false,
					},
					{
						reference: "external_index",
						ownership: "independently_managed",
						bytes: 4096,
						cleanup_eligible_if_removed: false,
					},
				],
			},
		],
	};
}

async function mockUsage(
	page: Page,
	options: {
		status?: QueryUsageAnalysisResponse["status"];
		analysisError?: number;
		listError?: number;
		mutationError?: number;
		count?: number;
		suggestions?: boolean;
	} = {},
) {
	let declarations = Array.from({ length: options.count ?? 1 }, (_, i) => ({
		...structuredClone(declaration),
		id: 17 + i,
		pattern: { ...pattern, path: i ? `field_${i}` : pattern.path },
	}));
	const requests: {
		method: string;
		path: string;
		body: unknown;
		revision: string | null;
	}[] = [];
	await page.route("**/_hubuum-bff/hubuum/api/v1/classes/10?*", (route) =>
		route.fulfill({
			json: {
				id: 10,
				name: "Devices",
				collection: { id: 1, name: "Infrastructure" },
			},
		}),
	);
	await page.route(`**${apiPath}**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname.slice(apiPath.length);
		const method = request.method();
		const body = request.postData() ? request.postDataJSON() : undefined;
		requests.push({
			method,
			path,
			body,
			revision: url.searchParams.get("expected_revision"),
		});
		if (path === "/analysis") {
			if (options.analysisError)
				return route.fulfill({
					status: options.analysisError,
					json: { message: "Analysis denied" },
				});
			const report = analysisReport();
			report.status = options.status ?? "complete";
			if (report.status !== "complete" || options.suggestions === false)
				report.suggestions = [];
			if (report.status === "unavailable") report.assessments = [];
			return route.fulfill({ json: report });
		}
		if (method === "GET")
			return options.listError
				? route.fulfill({ status: options.listError, body: "Not found" })
				: route.fulfill({ json: declarations });
		if (options.mutationError)
			return route.fulfill({
				status: options.mutationError,
				json: {
					message:
						options.mutationError === 409
							? "Revision conflict"
							: "UpdateClass required",
				},
			});
		if (method === "POST") {
			const created = {
				...declaration,
				id: 50,
				revision: 1,
				pattern: body.pattern,
			};
			declarations.push(created);
			return route.fulfill({ status: 201, json: created });
		}
		const id = Number(path.slice(1));
		if (method === "PUT") {
			const updated = {
				...declaration,
				id,
				pattern: body.pattern,
				revision: body.expected_revision + 1,
			};
			declarations = declarations.map((item) =>
				item.id === id ? updated : item,
			);
			return route.fulfill({ json: updated });
		}
		declarations = declarations.filter((item) => item.id !== id);
		return route.fulfill({ status: 204 });
	});
	return requests;
}

test.use({ trace: "off", reducedMotion: "reduce" });
test.describe("query usage workspace", () => {
	test.skip(
		!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD,
		"Requires an authenticated test session.",
	);
	test.beforeEach(async ({ page }) => {
		await page.goto("/login");
		await expect(
			page.getByRole("form", { name: "Login form" }),
		).not.toHaveAttribute("data-provider-discovery", "loading");
		const scope = page.locator("#identity-scope");
		if (await page.locator("select#identity-scope").isVisible())
			await scope.selectOption("local");
		else if ((await scope.getAttribute("type")) !== "hidden")
			await scope.fill("local");
		await page.getByLabel("Username").fill(process.env.E2E_USERNAME ?? "");
		await page
			.getByLabel("Password", { exact: true })
			.fill(process.env.E2E_PASSWORD ?? "");
		await page.getByRole("button", { name: "Enter workspace" }).click();
		await page.waitForURL("**/app");
	});

	test("creates, replaces and withdraws revision-checked declarations", async ({
		page,
	}) => {
		const requests = await mockUsage(page);
		await page.goto("/classes/10/query-usage");
		await page
			.getByRole("button", { name: "New declaration", exact: true })
			.click();
		let dialog = page.getByRole("dialog");
		await expect(dialog.getByLabel("JSON path")).toBeFocused();
		await dialog.getByLabel("JSON path").fill("weight");
		await dialog.getByLabel("Value type").selectOption("numeric");
		await dialog.getByLabel("Greater than", { exact: true }).check();
		await dialog.getByRole("button", { name: "Save declaration" }).click();
		const created = page.getByRole("article", {
			name: "Declaration weight",
			exact: true,
		});
		await expect(created).toContainText("Revision 1");
		await created.getByRole("button", { name: "Edit declaration" }).click();
		dialog = page.getByRole("dialog");
		await dialog.getByLabel("JSON path").fill("mass");
		await dialog.getByRole("button", { name: "Save declaration" }).click();
		const edited = page.getByRole("article", {
			name: "Declaration mass",
			exact: true,
		});
		await expect(edited).toContainText("Revision 2");
		await edited.getByRole("button", { name: "Withdraw declaration" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Withdraw declaration" })
			.click();
		await expect(edited).toHaveCount(0);
		expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
			pattern: {
				path: "mass",
				value_type: "numeric",
				operations: ["equals", "gt"],
			},
			expected_revision: 1,
		});
		expect(
			requests.find((request) => request.method === "DELETE")?.revision,
		).toBe("2");
	});

	test("analyzes hypothetical intent without saving and adopts only after review", async ({
		page,
	}) => {
		const requests = await mockUsage(page);
		await page.goto("/classes/10/query-usage");
		await expect(
			page.getByText("Analysis complete", { exact: true }),
		).toBeVisible();
		await page
			.getByText("Analyze hypothetical patterns (0/32)", { exact: true })
			.click();
		const form = page.getByRole("form", { name: "Hypothetical pattern" });
		await form.getByLabel("JSON path").fill("vendor");
		await form
			.getByRole("button", { name: "Analyze hypothetical pattern" })
			.click();
		await expect(
			page.getByRole("button", { name: "Remove hypothetical pattern 1" }),
		).toBeVisible();
		await expect
			.poll(
				() =>
					requests.filter((request) => request.path === "/analysis").at(-1)
						?.body,
			)
			.toEqual({
				proposed: [{ ...pattern, path: "vendor" }],
			});
		expect(
			requests.filter(
				(request) => request.method === "POST" && request.path === "",
			),
		).toHaveLength(0);
		await page.getByRole("button", { name: "Review and adopt" }).click();
		await expect(page.getByRole("dialog").getByLabel("JSON path")).toHaveValue(
			"hostname",
		);
		expect(
			requests.filter(
				(request) => request.method === "POST" && request.path === "",
			),
		).toHaveLength(0);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Save declaration" })
			.click();
		await expect(
			page.getByRole("button", { name: "Already declared" }),
		).toBeDisabled();
	});

	for (const status of [
		"unavailable",
		"insufficient_evidence",
		"complete",
	] as const) {
		test(`distinguishes ${status} with no suggestions`, async ({ page }) => {
			await mockUsage(page, { status, suggestions: false });
			await page.goto("/classes/10/query-usage");
			await expect(
				page.getByText(
					status === "complete"
						? "Analysis complete"
						: status === "unavailable"
							? "Analysis unavailable"
							: "Insufficient evidence",
					{ exact: true },
				),
			).toBeVisible();
			await expect(
				page.getByText(
					status === "complete"
						? "Review complete with no suggestions."
						: "No suggestions are available from this review.",
					{ exact: true },
				),
			).toBeVisible();
			await expect(
				page.getByRole("button", { name: "New declaration", exact: true }),
			).toBeEnabled();
		});
	}

	test("retains an editor draft after a conflict without replaying the write", async ({
		page,
	}) => {
		const requests = await mockUsage(page, { mutationError: 409 });
		await page.goto("/classes/10/query-usage");
		await page.getByRole("button", { name: "Edit declaration" }).click();
		await page.getByRole("dialog").getByLabel("JSON path").fill("new_serial");
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Save declaration" })
			.click();
		await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
			"Reload declarations and reopen",
		);
		await expect(page.getByRole("dialog").getByLabel("JSON path")).toHaveValue(
			"new_serial",
		);
		expect(requests.filter((request) => request.method === "PUT")).toHaveLength(
			1,
		);
		await page.getByRole("button", { name: "Cancel editing" }).click();
		await page.getByRole("button", { name: "Withdraw declaration" }).click();
		await page
			.getByRole("alertdialog")
			.getByRole("button", { name: "Withdraw declaration" })
			.click();
		await expect(
			page
				.getByRole("region", { name: "Query usage declarations" })
				.getByRole("alert"),
		).toContainText("Revision conflict");
		await expect(
			page.getByRole("article", { name: `Declaration ${pattern.path}` }),
		).toBeVisible();
	});

	test("shows forbidden analysis and writes without implying an empty review", async ({
		page,
	}) => {
		await mockUsage(page, { analysisError: 403, mutationError: 403 });
		await page.goto("/classes/10/query-usage");
		await expect(
			page
				.getByRole("region", { name: "Administrative analysis", exact: true })
				.getByRole("alert"),
		).toContainText("unscoped administrator access");
		await expect(
			page.getByText("Review complete with no suggestions."),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Edit declaration" }).click();
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Save declaration" })
			.click();
		await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
			"permission to update this class",
		);
	});

	test("handles an older server's plain-text 404", async ({ page }) => {
		const requests = await mockUsage(page, { listError: 404 });
		await page.goto("/classes/10/query-usage");
		await expect(
			page
				.getByRole("region", { name: "Query usage declarations", exact: true })
				.getByRole("alert"),
		).toContainText("unavailable for this class or server");
		await expect(
			page.getByRole("button", { name: "New declaration", exact: true }),
		).toBeDisabled();
		expect(requests.some((request) => request.path === "/analysis")).toBe(
			false,
		);
	});

	test("respects the class declaration limit", async ({ page }) => {
		await mockUsage(page, { count: 32 });
		await page.goto("/classes/10/query-usage");
		await expect(
			page.getByRole("heading", { name: "Declarations (32/32)" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "New declaration", exact: true }),
		).toBeDisabled();
		await expect(
			page.getByRole("button", { name: "Review and adopt" }),
		).toBeDisabled();
	});

	test("shows native ownership, diagnostics and observation settings accessibly on mobile", async ({
		page,
	}, testInfo) => {
		await mockUsage(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/classes/10/query-usage");
		await expect(
			page.getByText("Lock budget exceeded", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Independently managed", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("pending_cleanup", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "View observation configuration" }),
		).toHaveAttribute("href", "/admin/configuration");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		expect(
			(
				await new AxeBuilder({ page })
					.include(".query-usage-workspace")
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze()
			).violations,
		).toEqual([]);
		await page.screenshot({
			path: testInfo.outputPath("query-usage-mobile.png"),
			fullPage: true,
		});
		await page
			.getByRole("button", { name: "New declaration", exact: true })
			.click();
		expect(
			(
				await new AxeBuilder({ page })
					.include('[role="dialog"]')
					.withTags(["wcag2a", "wcag2aa", "wcag21aa"])
					.analyze()
			).violations,
		).toEqual([]);
		await page.keyboard.press("Escape");
		await expect(
			page.getByRole("dialog", {
				name: "Create query usage declaration",
				exact: true,
			}),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "New declaration", exact: true }),
		).toBeFocused();
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.evaluate(() =>
			document.documentElement.setAttribute("data-theme", "dark"),
		);
		await page.screenshot({
			path: testInfo.outputPath("query-usage-desktop-dark.png"),
			fullPage: true,
		});
	});

	test("displays effective observation configuration from the backend", async ({
		page,
	}) => {
		await page.goto("/admin/configuration");
		await expect(
			page.getByRole("heading", { name: "Query observations", exact: true }),
		).toBeVisible();
		const config = page.getByRole("article").filter({
			has: page.getByRole("heading", {
				name: "Query observations",
				exact: true,
			}),
		});
		for (const label of [
			"Collection",
			"Sample every",
			"Patterns per process",
			"Patterns per class",
			"Predicates per query",
			"Retention",
		])
			await expect(config.getByText(label, { exact: true })).toBeVisible();
	});
	test("round trips declarations and analysis through the live BFF", async ({
		page,
	}) => {
		test.skip(
			process.env.E2E_QUERY_USAGE_LIVE !== "1",
			"Requires a disposable backend.",
		);
		const prefix = "/_hubuum-bff/hubuum/api/v1";
		const headers = { Origin: new URL(page.url()).origin };
		const groups = await page.request.get(
			`${prefix}/iam/groups?include_total=false`,
		);
		expect(groups.status()).toBe(200);
		const adminGroup = (
			(await groups.json()) as { id: number; groupname: string }[]
		).find((group) => group.groupname === "admin");
		expect(adminGroup).toBeDefined();
		const collectionResponse = await page.request.post(
			`${prefix}/collections`,
			{
				headers,
				data: {
					name: `query-usage-e2e-${Date.now()}`,
					description: "Disposable query usage test",
					group_id: adminGroup?.id,
				},
			},
		);
		expect(collectionResponse.status()).toBe(201);
		const collection = (await collectionResponse.json()) as { id: number };
		try {
			const classResponse = await page.request.post(`${prefix}/classes`, {
				headers,
				data: {
					name: `query-usage-${Date.now()}`,
					description: "Disposable query usage test",
					collection_id: collection.id,
				},
			});
			expect(classResponse.status()).toBe(201);
			const resource = (await classResponse.json()) as { id: number };
			await page.goto(`/classes/${resource.id}`);
			await page
				.getByRole("link", { name: "Query usage", exact: true })
				.click();
			await expect(
				page.getByText("No query usage declarations yet.", { exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "New declaration", exact: true })
				.click();
			await page.getByRole("dialog").getByLabel("JSON path").fill("hostname");
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Save declaration" })
				.click();
			let card = page.getByRole("article", {
				name: "Declaration hostname",
				exact: true,
			});
			await expect(card).toContainText("Revision 1");
			await card.getByRole("button", { name: "Edit declaration" }).click();
			await page
				.getByRole("dialog")
				.getByLabel("JSON path")
				.fill("serial_number");
			await page
				.getByRole("dialog")
				.getByRole("button", { name: "Save declaration" })
				.click();
			card = page.getByRole("article", {
				name: "Declaration serial_number",
				exact: true,
			});
			await expect(card).toContainText("Revision 2");
			await expect(
				page.getByRole("region", {
					name: "Native resource coverage",
					exact: true,
				}),
			).toContainText("Declaration #");
			await card.getByRole("button", { name: "Withdraw declaration" }).click();
			await page
				.getByRole("alertdialog")
				.getByRole("button", { name: "Withdraw declaration" })
				.click();
			await expect(
				page.getByText("No query usage declarations yet.", { exact: true }),
			).toBeVisible();
		} finally {
			const cleanup = await page.request.delete(
				`${prefix}/collections/${collection.id}`,
				{ headers },
			);
			expect(cleanup.status()).toBe(204);
		}
	});
});
