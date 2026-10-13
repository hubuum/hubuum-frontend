import { expect, type Page, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	buildReportHtml,
	SORTABLE_REPORT_SANDBOX_POLICY,
} from "../../src/lib/report-html";
import { buildContentSecurityPolicy } from "../../src/lib/security-policy";

test.use({ timezoneId: "America/Los_Angeles" });

const inventory = `<table data-sortable aria-label="Inventory">
<thead><tr><th>Name</th><th>Room</th><th>Operating system</th><th data-sort-type="date">Date</th><th data-sort-type="number">Size</th></tr></thead>
<tbody>
<tr><td>host10</td><td>B10</td><td>Windows</td><td data-sort-value="2025-01-02T00:30:00+02:00">2 January</td><td data-sort-value="1200">1.2 TB</td></tr>
<tr><td>host2</td><td>B2</td><td>Linux</td><td data-sort-value="2025-01-01T23:00:00Z">1 January</td><td data-sort-value="900">900 GB</td></tr>
<tr><td>host9</td><td>B9</td><td>Linux</td><td data-sort-value="invalid">Unknown</td><td data-sort-value="">Unknown</td></tr>
</tbody><tfoot><tr><td colspan="5">3 hosts</td></tr></tfoot></table>`;

async function openReport(page: Page, html: string, preview = false) {
	await page.route("**/report-table-fixture", (route) =>
		route.fulfill({
			contentType: "text/html;charset=utf-8",
			headers: {
				"Content-Security-Policy": preview
					? buildContentSecurityPolicy("test-parent-nonce", false)
					: SORTABLE_REPORT_SANDBOX_POLICY,
			},
			body: preview
				? `<!doctype html><html><head><title>Preview</title></head><body>${renderToStaticMarkup(createElement("iframe", { sandbox: "allow-scripts", srcDoc: buildReportHtml(html), title: "Report preview" }))}</body></html>`
				: buildReportHtml(html),
		}),
	);
	await page.goto("/report-table-fixture");
	return preview ? page.frameLocator("iframe") : page;
}

for (const preview of [false, true]) {
	test(`sorts every column under the ${preview ? "preview" : "standalone"} CSP`, async ({
		page,
	}) => {
		const report = await openReport(page, inventory, preview);
		const table = report.getByRole("table", { name: "Inventory" });
		const names = table.locator("tbody tr td:first-child");
		await expect(names).toHaveText(["host10", "host2", "host9"]);
		const room = table.getByRole("button", { name: "Room", exact: true });
		await room.focus();
		await page.keyboard.press("Enter");
		await expect(names).toHaveText(["host2", "host9", "host10"]);
		await expect(
			table.getByRole("columnheader", { name: "Room" }),
		).toHaveAttribute("aria-sort", "ascending");
		await page.keyboard.press("Space");
		await expect(names).toHaveText(["host10", "host9", "host2"]);
		await expect(
			table.getByRole("columnheader", { name: "Room" }),
		).toHaveAttribute("aria-sort", "descending");
		await table.getByRole("button", { name: "Name", exact: true }).click();
		await expect(names).toHaveText(["host2", "host9", "host10"]);
		await expect(table.locator("[aria-sort]")).toHaveCount(1);
		await table
			.getByRole("button", { name: "Operating system", exact: true })
			.click();
		await expect(names).toHaveText(["host2", "host9", "host10"]);
		await table.getByRole("button", { name: "Date", exact: true }).click();
		await expect(names).toHaveText(["host10", "host2", "host9"]);
		await table.getByRole("button", { name: "Date", exact: true }).click();
		await expect(names).toHaveText(["host2", "host10", "host9"]);
		await table.getByRole("button", { name: "Size", exact: true }).click();
		await expect(names).toHaveText(["host2", "host10", "host9"]);
		await table.getByRole("button", { name: "Size", exact: true }).click();
		await expect(names).toHaveText(["host10", "host2", "host9"]);
		await expect(table.locator("tfoot")).toHaveText("3 hosts");
	});

	test(`blocks template code and origin access in ${preview ? "preview" : "standalone"} reports`, async ({
		page,
	}) => {
		const blockedScripts: string[] = [];
		page.on("requestfailed", (request) => {
			if (request.url().endsWith("/untrusted-report.js")) {
				blockedScripts.push(request.failure()?.errorText ?? "");
			}
		});
		const report = await openReport(
			page,
			`<!doctype html><html lang="en"><head><title>Inventory</title></head><body>
${inventory}
<script>document.body.dataset.executed = "yes"</script>
<script nonce="test-parent-nonce">document.body.dataset.executed = "yes"</script>
<script src="/untrusted-report.js"></script>
<button onclick="document.body.dataset.executed = 'yes'">Untrusted handler</button>
<a href="javascript:document.body.dataset.executed='yes'">Untrusted link</a>
</body></html>`,
			preview,
		);
		await report.getByRole("button", { name: "Name", exact: true }).click();
		await expect(report.locator("tbody tr td:first-child")).toHaveText([
			"host2",
			"host9",
			"host10",
		]);
		await report.getByRole("button", { name: "Untrusted handler" }).click();
		await report.getByRole("link", { name: "Untrusted link" }).click();
		await expect(report.locator("body")).not.toHaveAttribute("data-executed");
		expect(blockedScripts).toEqual([expect.stringMatching(/csp/i)]);
		const access = await report.locator("html").evaluate(async () => {
			const denied = (read: () => unknown) => {
				try {
					read();
					return false;
				} catch {
					return true;
				}
			};
			return {
				cookie: denied(() => document.cookie),
				storage: denied(() => window.localStorage),
				parent:
					window.parent === window || denied(() => window.parent.document),
				network: await fetch("/untrusted-report-fetch").then(
					() => false,
					() => true,
				),
			};
		});
		expect(access).toEqual({
			cookie: true,
			storage: true,
			parent: true,
			network: true,
		});
	});
}

test("keeps tables independent, sorts within groups, and respects an initial order", async ({
	page,
}) => {
	const html = `<table data-sortable aria-label="Groups"><thead><tr><th aria-sort="ascending">Name</th><th data-sort-type="none">Notes</th></tr></thead>
<tbody><tr><td>a</td><td>first</td></tr><tr><td>b</td><td>second</td></tr></tbody>
<tbody><tr><td>c</td><td>third</td></tr><tr><td>d</td><td>fourth</td></tr></tbody></table>${inventory}`;
	const report = await openReport(page, html);
	const groups = report.getByRole("table", { name: "Groups" });
	await expect(groups.getByRole("button")).toHaveCount(1);
	await groups.getByRole("button", { name: "Name", exact: true }).click();
	await expect(groups.locator("tbody tr td:first-child")).toHaveText([
		"b",
		"a",
		"d",
		"c",
	]);
	await expect(
		report
			.getByRole("table", { name: "Inventory" })
			.locator("tbody tr td:first-child"),
	).toHaveText(["host10", "host2", "host9"]);
});

test("leaves unmarked and structurally unsupported tables unchanged", async ({
	page,
}) => {
	const report = await openReport(
		page,
		inventory.replace("data-sortable", "") +
			`<table data-sortable><thead><tr><th>Grouped</th></tr></thead><tbody><tr><td colspan="2">Spanning row</td></tr></tbody></table>`,
	);
	await expect(report.getByRole("table")).toHaveCount(2);
	await expect(report.getByRole("button")).toHaveCount(0);
});

test("treats Hubuum timestamps as UTC and keeps invalid calendar dates last", async ({
	page,
}) => {
	const report = await openReport(
		page,
		`<table data-sortable><thead><tr><th data-sort-type="date">Date</th></tr></thead><tbody>
<tr><td>2026-02-30</td></tr><tr><td>2026-01-01T02:00:00</td></tr>
<tr><td>2026-01-01T04:00:00Z</td></tr><tr><td>2026-01-01</td></tr>
</tbody></table>`,
	);
	await report.getByRole("button", { name: "Date", exact: true }).click();
	await expect(report.locator("tbody td")).toHaveText([
		"2026-01-01",
		"2026-01-01T02:00:00",
		"2026-01-01T04:00:00Z",
		"2026-02-30",
	]);
});
