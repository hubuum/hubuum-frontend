export const MIN_RESIZABLE_COLUMN_WIDTH = 48;

export type TableColumnResize = {
	columnWidths: number[];
	tableWidth: number;
};

export function resizeTableColumn(
	columnWidths: readonly number[],
	columnIndex: number,
	delta: number,
	minWidth = MIN_RESIZABLE_COLUMN_WIDTH,
): TableColumnResize {
	const nextWidths = [...columnWidths];
	const currentWidth = nextWidths[columnIndex];

	if (currentWidth === undefined) {
		return {
			columnWidths: nextWidths,
			tableWidth: nextWidths.reduce((total, width) => total + width, 0),
		};
	}

	nextWidths[columnIndex] = Math.max(minWidth, currentWidth + delta);

	return {
		columnWidths: nextWidths,
		tableWidth: nextWidths.reduce((total, width) => total + width, 0),
	};
}
