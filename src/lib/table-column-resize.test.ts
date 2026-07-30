import { describe, expect, it } from "vitest";

import {
	MIN_RESIZABLE_COLUMN_WIDTH,
	resizeTableColumn,
} from "@/lib/table-column-resize";

describe("resizeTableColumn", () => {
	it("changes only the selected column width", () => {
		const result = resizeTableColumn([34, 72, 180, 220], 2, 45);

		expect(result.columnWidths).toEqual([34, 72, 225, 220]);
		expect(result.tableWidth).toBe(551);
	});

	it("keeps columns to the left fixed when the selected column shrinks", () => {
		const before = [34, 72, 180, 220];
		const after = resizeTableColumn(before, 2, -60).columnWidths;
		const offsets = (widths: readonly number[]) =>
			widths.map((_, index) =>
				widths.slice(0, index).reduce((total, width) => total + width, 0),
			);

		expect(offsets(after).slice(0, 3)).toEqual(offsets(before).slice(0, 3));
		expect(offsets(after)[3]).toBe(offsets(before)[3] - 60);
	});

	it("enforces the minimum without redistributing width", () => {
		const result = resizeTableColumn([34, 72, 180], 1, -200);

		expect(result.columnWidths).toEqual([
			34,
			MIN_RESIZABLE_COLUMN_WIDTH,
			180,
		]);
		expect(result.tableWidth).toBe(262);
	});

	it("expands the final column and the table to the right", () => {
		const result = resizeTableColumn([34, 72, 180], 2, 80);

		expect(result.columnWidths).toEqual([34, 72, 260]);
		expect(result.tableWidth).toBe(366);
	});

	it("leaves the geometry unchanged for an unknown column", () => {
		const result = resizeTableColumn([34, 72], 3, 40);

		expect(result).toEqual({
			columnWidths: [34, 72],
			tableWidth: 106,
		});
	});
});
