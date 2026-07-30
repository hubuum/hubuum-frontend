import { useEffect, useRef } from "react";

import { resizeTableColumn } from "@/lib/table-column-resize";
import { writeDeviceSetting } from "@/lib/user-settings-client";
import { DEVICE_SETTING_KEYS } from "@/lib/user-settings-types";

type ResizableTableOptions = {
	tableId: string;
	storageKey?: string;
	columnSignature?: string;
};

export function useResizableTable({
	tableId,
	storageKey,
	columnSignature,
}: ResizableTableOptions) {
	const tableRef = useRef<HTMLTableElement | null>(null);

	useEffect(() => {
		const table = document.getElementById(tableId) as HTMLTableElement | null;
		if (!table) {
			return;
		}

		tableRef.current = table;
		table.dataset.resizableColumnSignature = columnSignature ?? "";
		const headers = Array.from(
			table.querySelectorAll<HTMLTableCellElement>("thead th"),
		);
		const columns = Array.from(
			table.querySelectorAll<HTMLTableColElement>("colgroup col"),
		);
		const storage = storageKey
			? DEVICE_SETTING_KEYS.tableWidths(storageKey)
			: null;
		const getColumnKey = (header: HTMLTableCellElement, index: number) =>
			header.dataset.columnKey ?? String(index);
		const isSelectionColumn = (header: HTMLTableCellElement) =>
			header.classList.contains("check-col");
		const setColumnWidth = (index: number, width: number) => {
			const target = columns[index] ?? headers[index];
			if (target) {
				target.style.width = `${width}px`;
			}
		};
		headers.forEach((header, index) => {
			if (isSelectionColumn(header)) {
				(columns[index] ?? header).style.removeProperty("width");
			}
		});
		const readColumnWidths = () =>
			headers.map((header) => {
				const renderedWidth = header.getBoundingClientRect().width;
				if (!isSelectionColumn(header)) {
					return renderedWidth;
				}

				const fixedWidth = Number.parseFloat(
					getComputedStyle(header).maxWidth,
				);
				return Number.isFinite(fixedWidth) && fixedWidth > 0
					? fixedWidth
					: renderedWidth;
			});
		const setTableGeometry = (widths: readonly number[]) => {
			widths.forEach((width, index) => {
				if (width > 0) {
					setColumnWidth(index, width);
				}
			});
			const tableWidth = widths.reduce((total, width) => total + width, 0);
			table.style.width = `${tableWidth}px`;
			table.style.minWidth = `${tableWidth}px`;
		};
		const releaseTableWidth = () => {
			table.style.removeProperty("width");
			table.style.removeProperty("min-width");
		};

		// Load saved widths
		if (storage) {
			try {
				const saved = localStorage.getItem(storage);
				if (saved) {
					const widths = JSON.parse(saved) as Record<string, number>;
					headers.forEach((th, index) => {
						if (isSelectionColumn(th)) {
							return;
						}
						const width = widths[getColumnKey(th, index)];
						if (width) {
							setColumnWidth(index, width);
						}
					});
				}
			} catch {
				// Ignore parse errors
			}
		}

		window.addEventListener("resize", releaseTableWidth);

		// Add resize handles to every data column. The selection column remains fixed.
		const removeHandleListeners: Array<() => void> = [];
		headers.forEach((th, index) => {
			const element = th;
			if (element.classList.contains("check-col")) {
				return;
			}

			element.classList.add("resizable");

			const handle = document.createElement("div");
			handle.className = "resize-handle";
			element.appendChild(handle);

			let startX = 0;
			let startWidths: number[] = [];
			let currentWidths: number[] = [];
			let suppressHeaderClick = false;
			let clickResetTimer: number | null = null;

			let onMouseMove: ((e: MouseEvent) => void) | null = null;
			let onMouseUp: (() => void) | null = null;

			const onMouseDown = (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				if (clickResetTimer !== null) {
					window.clearTimeout(clickResetTimer);
					clickResetTimer = null;
				}
				suppressHeaderClick = true;
				startX = e.clientX;
				startWidths = readColumnWidths();
				currentWidths = startWidths;
				setTableGeometry(startWidths);
				handle.classList.add("is-resizing");
				document.body.classList.add("is-resizing-table-column");

				onMouseMove = (e: MouseEvent) => {
					const diff = e.clientX - startX;
					currentWidths = resizeTableColumn(
						startWidths,
						index,
						diff,
					).columnWidths;
					setTableGeometry(currentWidths);
				};

				onMouseUp = () => {
					handle.classList.remove("is-resizing");
					document.body.classList.remove("is-resizing-table-column");
					if (onMouseMove)
						document.removeEventListener("mousemove", onMouseMove);
					if (onMouseUp) document.removeEventListener("mouseup", onMouseUp);
					clickResetTimer = window.setTimeout(() => {
						suppressHeaderClick = false;
						clickResetTimer = null;
					}, 0);

					// Save widths
					if (storage) {
						const widths: Record<string, number> = {};
						headers.forEach((h, i) => {
							if (isSelectionColumn(h)) {
								return;
							}
							const width = currentWidths[i];
							if (width) {
								widths[getColumnKey(h, i)] = width;
							}
						});
						try {
							writeDeviceSetting(storage, JSON.stringify(widths));
						} catch {
							// Ignore storage errors
						}
					}
				};

				document.addEventListener("mousemove", onMouseMove);
				document.addEventListener("mouseup", onMouseUp);
			};
			const onHandleClick = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
			};
			const onHeaderClickCapture = (event: MouseEvent) => {
				if (!suppressHeaderClick) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				suppressHeaderClick = false;
				if (clickResetTimer !== null) {
					window.clearTimeout(clickResetTimer);
					clickResetTimer = null;
				}
			};

			handle.addEventListener("mousedown", onMouseDown);
			handle.addEventListener("click", onHandleClick);
			element.addEventListener("click", onHeaderClickCapture, true);
			removeHandleListeners.push(() => {
				handle.removeEventListener("mousedown", onMouseDown);
				handle.removeEventListener("click", onHandleClick);
				element.removeEventListener("click", onHeaderClickCapture, true);
				if (clickResetTimer !== null) {
					window.clearTimeout(clickResetTimer);
				}
				if (onMouseMove)
					document.removeEventListener("mousemove", onMouseMove);
				if (onMouseUp) document.removeEventListener("mouseup", onMouseUp);
			});
		});

		// Cleanup function
		return () => {
			document.body.classList.remove("is-resizing-table-column");
			window.removeEventListener("resize", releaseTableWidth);
			releaseTableWidth();
			delete table.dataset.resizableColumnSignature;
			removeHandleListeners.forEach((removeListeners) => {
				removeListeners();
			});
			headers.forEach((th) => {
				const element = th as HTMLElement;
				element.classList.remove("resizable");
				const handles = th.querySelectorAll(".resize-handle");
				handles.forEach((handle) => {
					handle.remove();
				});
			});
		};
	}, [columnSignature, tableId, storageKey]);

	return tableRef;
}
