import { useEffect, useMemo, useRef, useState } from "react";

type UseTableKeyboardNavOptions<T> = {
	items: T[];
	getId: (item: T) => number;
	onOpen: (item: T) => void;
	enabled?: boolean;
};

export function useTableKeyboardNav<T>({
	items,
	getId,
	onOpen,
	enabled = true,
}: UseTableKeyboardNavOptions<T>) {
	const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
	const tableRef = useRef<HTMLTableElement | null>(null);
	const itemSignature = useMemo(
		() => items.map((item) => getId(item)).join(","),
		[items, getId],
	);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		const table = tableRef.current;
		if (!table) return;
		const originalTabIndex = table.getAttribute("tabindex");
		table.tabIndex = 0;

		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			if (
				event.defaultPrevented ||
				event.altKey ||
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				!table.contains(target) ||
				target.closest(
					"input, select, textarea, button, th, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='alertdialog']",
				) ||
				(event.key === "Enter" && target.closest("a[href]"))
			) {
				return;
			}

			// Arrow Down
			if (event.key === "ArrowDown") {
				event.preventDefault();
				setFocusedIndex((current) => {
					if (current === null) {
						return items.length > 0 ? 0 : null;
					}
					return items.length ? Math.min(current + 1, items.length - 1) : null;
				});
			}

			// Arrow Up
			if (event.key === "ArrowUp") {
				event.preventDefault();
				setFocusedIndex((current) => {
					if (current === null) {
						return items.length > 0 ? items.length - 1 : null;
					}
					return Math.max(current - 1, 0);
				});
			}

			// Enter - open the focused row
			if (
				event.key === "Enter" &&
				focusedIndex !== null &&
				items[focusedIndex]
			) {
				event.preventDefault();
				onOpen(items[focusedIndex]);
			}
		};

		table.addEventListener("keydown", onKeyDown);
		return () => {
			table.removeEventListener("keydown", onKeyDown);
			if (originalTabIndex === null) table.removeAttribute("tabindex");
			else table.setAttribute("tabindex", originalTabIndex);
		};
	}, [enabled, items, focusedIndex, onOpen]);

	// Scroll focused row into view
	useEffect(() => {
		if (focusedIndex === null) {
			return;
		}

		const container = tableRef.current;
		if (!container) return;
		const row = container.querySelector(
			`[data-table-row-index="${focusedIndex}"]`,
		) as HTMLElement | null;
		if (row) {
			row.tabIndex = -1;
			row.focus({ preventScroll: true });
			row.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}, [focusedIndex]);

	// Reset focus when items change
	// biome-ignore lint/correctness/useExhaustiveDependencies: row identity changes under filtering and pagination even when the item count is unchanged.
	useEffect(() => {
		setFocusedIndex(null);
	}, [itemSignature]);

	return {
		focusedIndex,
		focusedId:
			focusedIndex !== null && items[focusedIndex]
				? getId(items[focusedIndex])
				: null,
		tableRef,
	};
}
