import { useEffect, useRef } from "react";

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
		const storage = storageKey ? `hubuum.table.${storageKey}.widths` : null;
		const getColumnKey = (header: HTMLTableCellElement, index: number) =>
			header.dataset.columnKey ?? String(index);
		const setColumnWidth = (index: number, width: number) => {
			const target = columns[index] ?? headers[index];
			if (target) {
				target.style.width = `${width}px`;
			}
		};

		// Load saved widths
		if (storage) {
			try {
				const saved = localStorage.getItem(storage);
				if (saved) {
					const widths = JSON.parse(saved) as Record<string, number>;
					headers.forEach((th, index) => {
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

		// Add resize handles to all headers except checkbox and last column
		headers.forEach((th, index) => {
			const element = th;
			if (
				element.classList.contains("check-col") ||
				index === headers.length - 1
			) {
				return;
			}

			element.classList.add("resizable");

			const handle = document.createElement("div");
			handle.className = "resize-handle";
			element.appendChild(handle);

			let startX = 0;
			let startWidth = 0;

			let onMouseMove: ((e: MouseEvent) => void) | null = null;
			let onMouseUp: (() => void) | null = null;

			const onMouseDown = (e: MouseEvent) => {
				e.preventDefault();
				startX = e.clientX;
				startWidth = element.offsetWidth;
				handle.classList.add("is-resizing");

				onMouseMove = (e: MouseEvent) => {
					const diff = e.clientX - startX;
					const newWidth = Math.max(50, startWidth + diff);
					setColumnWidth(index, newWidth);
				};

				onMouseUp = () => {
					handle.classList.remove("is-resizing");
					if (onMouseMove)
						document.removeEventListener("mousemove", onMouseMove);
					if (onMouseUp) document.removeEventListener("mouseup", onMouseUp);

					// Save widths
					if (storage) {
						const widths: Record<string, number> = {};
						headers.forEach((h, i) => {
							const width = h.offsetWidth;
							if (width) {
								widths[getColumnKey(h, i)] = width;
							}
						});
						try {
							localStorage.setItem(storage, JSON.stringify(widths));
						} catch {
							// Ignore storage errors
						}
					}
				};

				document.addEventListener("mousemove", onMouseMove);
				document.addEventListener("mouseup", onMouseUp);
			};

			handle.addEventListener("mousedown", onMouseDown);
		});

		// Cleanup function
		return () => {
			delete table.dataset.resizableColumnSignature;
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
