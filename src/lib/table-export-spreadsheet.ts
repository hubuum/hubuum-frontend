import type { TableExportFormat, TableExportSnapshot } from "@/lib/table-export";
import {
	normalizeSpreadsheetCell,
	sanitizeSheetName,
} from "@/lib/table-export";
import type { Zippable } from "fflate";

const ODS_MIME_TYPE = "application/vnd.oasis.opendocument.spreadsheet";

function toStandaloneArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

async function normalizeOdsPackage(bytes: ArrayBuffer): Promise<ArrayBuffer> {
	const { strToU8, unzipSync, zipSync } = await import("fflate");
	const unpacked = unzipSync(new Uint8Array(bytes));
	const mimetype = unpacked.mimetype ?? strToU8(ODS_MIME_TYPE);
	const entries: Zippable = {
		mimetype: [mimetype, { level: 0 }],
	};
	for (const [path, contents] of Object.entries(unpacked)) {
		if (path !== "mimetype") {
			entries[path] = contents;
		}
	}
	return toStandaloneArrayBuffer(
		zipSync(entries, {
			level: 6,
			mtime: new Date("1980-01-01T00:00:00Z"),
		}),
	);
}

export async function createSpreadsheetBytes(
	snapshot: TableExportSnapshot,
	format: Extract<TableExportFormat, "xlsx" | "ods">,
): Promise<ArrayBuffer> {
	const XLSX = await import("xlsx/dist/xlsx.mini.min.js");
	const matrix = [
		snapshot.columns.map((column) => column.label),
		...snapshot.rows.map((row) => row.map(normalizeSpreadsheetCell)),
	];
	const worksheet = XLSX.utils.aoa_to_sheet(matrix);
	worksheet["!cols"] = snapshot.columns.map((column, columnIndex) => {
		let width = column.label.length;
		for (const row of matrix.slice(1, 201)) {
			width = Math.max(width, String(row[columnIndex] ?? "").length);
		}
		return { wch: Math.max(10, Math.min(48, width + 2)) };
	});
	if (snapshot.rows.length > 0 && snapshot.columns.length > 0) {
		worksheet["!autofilter"] = {
			ref: XLSX.utils.encode_range({
				s: { r: 0, c: 0 },
				e: { r: snapshot.rows.length, c: snapshot.columns.length - 1 },
			}),
		};
	}

	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		workbook,
		worksheet,
		sanitizeSheetName(snapshot.sheetName),
	);
	const output = XLSX.write(workbook, {
		bookType: format,
		compression: true,
		type: "array",
	});
	const bytes = output instanceof ArrayBuffer
		? output
		: new Uint8Array(output).buffer;
	return format === "ods" ? normalizeOdsPackage(bytes) : bytes;
}
