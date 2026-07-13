export type TableExportFormat = "csv" | "json" | "xlsx" | "ods";

export type TableExportColumn<Row> = {
	key: string;
	label: string;
	getValue: (row: Row) => unknown;
};

export type TableExportView<Row> = {
	id: string;
	fileName: string;
	sheetName: string;
	columns: readonly TableExportColumn<Row>[];
	rows: readonly Row[];
};

export type TableExportSnapshot = {
	id: string;
	fileName: string;
	sheetName: string;
	columns: Array<{ key: string; label: string }>;
	rows: unknown[][];
};

export type TableExportFile = {
	bytes: BlobPart;
	extension: TableExportFormat;
	mimeType: string;
};

export const TABLE_EXPORT_FORMATS: ReadonlyArray<{
	format: TableExportFormat;
	label: string;
	description: string;
}> = [
	{
		format: "csv",
		label: "CSV (.csv)",
		description: "Compatible with spreadsheet and data tools",
	},
	{
		format: "json",
		label: "JSON (.json)",
		description: "Typed values with column metadata",
	},
	{
		format: "xlsx",
		label: "Excel workbook (.xlsx)",
		description: "Typed cells for Microsoft Excel",
	},
	{
		format: "ods",
		label: "OpenDocument (.ods)",
		description: "For LibreOffice and OpenOffice",
	},
];

const MIME_TYPES: Record<TableExportFormat, string> = {
	csv: "text/csv;charset=utf-8",
	json: "application/json;charset=utf-8",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
};

export function createTableExportSnapshot<Row>(
	view: TableExportView<Row>,
): TableExportSnapshot {
	const duplicateKeys = new Set<string>();
	const seenKeys = new Set<string>();
	for (const column of view.columns) {
		if (seenKeys.has(column.key)) {
			duplicateKeys.add(column.key);
		}
		seenKeys.add(column.key);
	}
	if (duplicateKeys.size > 0) {
		throw new Error(
			`Export column keys must be unique: ${[...duplicateKeys].join(", ")}`,
		);
	}

	return {
		id: view.id,
		fileName: view.fileName,
		sheetName: view.sheetName,
		columns: view.columns.map(({ key, label }) => ({ key, label })),
		rows: view.rows.map((row) =>
			view.columns.map((column) => column.getValue(row)),
		),
	};
}

function normalizeJsonValue(value: unknown): unknown {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		return value.map(normalizeJsonValue);
	}
	if (typeof value === "object") {
		const normalized: Record<string, unknown> = {};
		for (const [key, nestedValue] of Object.entries(
			value as Record<string, unknown>,
		)) {
			normalized[key] = normalizeJsonValue(nestedValue);
		}
		return normalized;
	}
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	return String(value);
}

export function normalizeSpreadsheetCell(
	value: unknown,
): string | number | boolean | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	if (typeof value === "object") {
		try {
			return JSON.stringify(normalizeJsonValue(value));
		} catch {
			return String(value);
		}
	}
	return String(value);
}

function protectCsvCell(value: string): string {
	return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function quoteCsvCell(value: unknown): string {
	const normalized = normalizeSpreadsheetCell(value);
	const text =
		normalized === null
			? ""
			: typeof normalized === "string"
				? protectCsvCell(normalized)
				: String(normalized);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeTableSnapshotCsv(
	snapshot: TableExportSnapshot,
): string {
	const matrix = [
		snapshot.columns.map((column) => column.label),
		...snapshot.rows,
	];
	return `\uFEFF${matrix
		.map((row) => row.map(quoteCsvCell).join(","))
		.join("\r\n")}\r\n`;
}

export function serializeTableSnapshotJson(
	snapshot: TableExportSnapshot,
): string {
	const rows = snapshot.rows.map((row) => {
		return Object.fromEntries(
			snapshot.columns.map((column, index) => [
				column.key,
				normalizeJsonValue(row[index]),
			]),
		);
	});

	return JSON.stringify(
		{
			view: snapshot.id,
			columns: snapshot.columns,
			rows,
		},
		null,
		2,
	);
}

export function sanitizeExportFileName(value: string): string {
	const withoutInvalidCharacters = [...value.normalize("NFKD")]
		.map((character) =>
			character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character)
				? "-"
				: character,
		)
		.join("");
	const sanitized = withoutInvalidCharacters
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	return truncateUtf16(sanitized, 96) || "table-view";
}

function truncateUtf16(value: string, maxLength: number): string {
	let result = "";
	for (const character of value) {
		if (result.length + character.length > maxLength) break;
		result += character;
	}
	return result;
}

export function sanitizeSheetName(value: string): string {
	let sanitized = value
		.replace(/[\\/?*[\]:]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^'+|'+$/g, "")
		.trim();
	if (sanitized.toLocaleLowerCase("en-US") === "history") {
		sanitized = "History view";
	}
	return truncateUtf16(sanitized, 31) || "Table view";
}

export async function createTableExportFile(
	snapshot: TableExportSnapshot,
	format: TableExportFormat,
): Promise<TableExportFile> {
	if (format === "csv") {
		return {
			bytes: serializeTableSnapshotCsv(snapshot),
			extension: format,
			mimeType: MIME_TYPES[format],
		};
	}
	if (format === "json") {
		return {
			bytes: serializeTableSnapshotJson(snapshot),
			extension: format,
			mimeType: MIME_TYPES[format],
		};
	}

	const { createSpreadsheetBytes } = await import(
		"@/lib/table-export-spreadsheet"
	);
	return {
		bytes: await createSpreadsheetBytes(snapshot, format),
		extension: format,
		mimeType: MIME_TYPES[format],
	};
}

export function downloadTableExportFile(
	snapshot: TableExportSnapshot,
	file: TableExportFile,
): string {
	const blob = new Blob([file.bytes], { type: file.mimeType });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${sanitizeExportFileName(snapshot.fileName)}.${file.extension}`;
	link.style.display = "none";
	document.body.append(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 0);
	return link.download;
}
