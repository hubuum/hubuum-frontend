import { describe, expect, it } from "vitest";
import {
	createTableExportSnapshot,
	normalizeSpreadsheetCell,
	sanitizeExportFileName,
	sanitizeSheetName,
	serializeTableSnapshotCsv,
	serializeTableSnapshotJson,
} from "@/lib/table-export";
import { createSpreadsheetBytes } from "@/lib/table-export-spreadsheet";

describe("table export", () => {
	const snapshot = createTableExportSnapshot({
		id: "objects",
		fileName: "Hosts / current view",
		sheetName: "Hosts: current/view",
		columns: [
			{ key: "id", label: "ID", getValue: (row: TestRow) => row.id },
			{ key: "name", label: "Name", getValue: (row: TestRow) => row.name },
			{ key: "data", label: "Data", getValue: (row: TestRow) => row.data },
		],
		rows: [
			{
				id: 31,
				name: '=HYPERLINK("https://invalid.test")',
				data: { enabled: true, tags: ["oslo", "prod"] },
			},
		],
	});

	it("captures the visible column and row order", () => {
		expect(snapshot.columns.map((column) => column.key)).toEqual([
			"id",
			"name",
			"data",
		]);
		expect(snapshot.rows[0]).toEqual([
			31,
			'=HYPERLINK("https://invalid.test")',
			{ enabled: true, tags: ["oslo", "prod"] },
		]);
	});

	it("rejects duplicate stable keys", () => {
		expect(() =>
			createTableExportSnapshot({
				id: "bad",
				fileName: "bad",
				sheetName: "bad",
				columns: [
					{ key: "name", label: "Name", getValue: () => "one" },
					{ key: "name", label: "Other name", getValue: () => "two" },
				],
				rows: [{}],
			}),
		).toThrow(/must be unique/);
	});

	it("writes RFC-style CSV and neutralizes spreadsheet formulas", () => {
		const csv = serializeTableSnapshotCsv(snapshot);
		expect(csv.startsWith("\uFEFFID,Name,Data\r\n")).toBe(true);
		expect(csv).toContain("\"'=HYPERLINK(\"\"https://invalid.test\"\")\"");
		expect(csv).toContain(
			'"{""enabled"":true,""tags"":[""oslo"",""prod""]}"',
		);
		expect(csv.endsWith("\r\n")).toBe(true);
		expect(
			serializeTableSnapshotCsv({
				...snapshot,
				columns: [{ key: "temperature", label: "Temperature" }],
				rows: [[-12.5]],
			}),
		).toContain("\r\n-12.5\r\n");
	});

	it("writes JSON with typed row values and column metadata", () => {
		const json = JSON.parse(serializeTableSnapshotJson(snapshot));
		expect(json.columns[1]).toEqual({ key: "name", label: "Name" });
		expect(json.rows[0]).toEqual({
			id: 31,
			name: '=HYPERLINK("https://invalid.test")',
			data: { enabled: true, tags: ["oslo", "prod"] },
		});
	});

	it("preserves JSON columns named __proto__", () => {
		const json = JSON.parse(
			serializeTableSnapshotJson({
				...snapshot,
				columns: [{ key: "__proto__", label: "Prototype" }],
				rows: [["safe value"]],
			}),
		);
		expect(json.rows[0]).toHaveProperty("__proto__", "safe value");
	});

	it("normalizes complex spreadsheet values without creating formulas", () => {
		expect(normalizeSpreadsheetCell({ enabled: true })).toBe(
			'{"enabled":true}',
		);
		expect(normalizeSpreadsheetCell("=1+1")).toBe("=1+1");
		expect(normalizeSpreadsheetCell(null)).toBe(null);
	});

	it("sanitizes filenames and workbook sheet names", () => {
		expect(sanitizeExportFileName(" Hosts / current:view ")).toBe(
			"Hosts-current-view",
		);
		expect(sanitizeSheetName("Hosts: current/view [prod]")).toBe(
			"Hosts current view prod",
		);
		expect(sanitizeSheetName("'History'")).toBe("History view");
		expect(sanitizeSheetName(`${"a".repeat(30)}😀`)).toBe("a".repeat(30));
	});

	it.each(["xlsx", "ods"] as const)(
		"round trips typed cells through a %s workbook",
		async (format) => {
			const bytes = await createSpreadsheetBytes(snapshot, format);
			expect(bytes.byteLength).toBeGreaterThan(500);

			const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
			const workbook = XLSX.read(bytes, { type: "array" });
			const worksheet = workbook.Sheets[workbook.SheetNames[0]];
			const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean>>(
				worksheet,
				{ header: 1, raw: true },
			);
			expect(matrix[0]).toEqual(["ID", "Name", "Data"]);
			expect(matrix[1]).toEqual([
				31,
				'=HYPERLINK("https://invalid.test")',
				'{"enabled":true,"tags":["oslo","prod"]}',
			]);
		},
	);

	it.each(["xlsx", "ods"] as const)(
		"preserves numeric and boolean cell types in %s",
		async (format) => {
			const bytes = await createSpreadsheetBytes(
				{
					...snapshot,
					columns: [
						{ key: "score", label: "Score" },
						{ key: "enabled", label: "Enabled" },
					],
					rows: [[12.5, true]],
				},
				format,
			);
			const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
			const workbook = XLSX.read(bytes, { type: "array" });
			const worksheet = workbook.Sheets[workbook.SheetNames[0]];
			expect(worksheet.A2).toMatchObject({ t: "n", v: 12.5 });
			expect(worksheet.B2).toMatchObject({ t: "b", v: true });
		},
	);

	it("writes sanitized reserved sheet names", async () => {
		const bytes = await createSpreadsheetBytes(
			{ ...snapshot, sheetName: "'History'" },
			"xlsx",
		);
		const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
		const workbook = XLSX.read(bytes, { type: "array" });
		expect(workbook.SheetNames).toEqual(["History view"]);
	});

	it("writes the ODS mimetype first, uncompressed, and without extra fields", async () => {
		const bytes = new Uint8Array(await createSpreadsheetBytes(snapshot, "ods"));
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		expect(view.getUint32(0, true)).toBe(0x04034b50);
		expect(view.getUint16(8, true)).toBe(0);
		const fileNameLength = view.getUint16(26, true);
		const extraFieldLength = view.getUint16(28, true);
		const firstFileName = new TextDecoder().decode(
			bytes.slice(30, 30 + fileNameLength),
		);
		expect(firstFileName).toBe("mimetype");
		expect(extraFieldLength).toBe(0);
	});
});

type TestRow = {
	id: number;
	name: string;
	data: Record<string, unknown>;
};
