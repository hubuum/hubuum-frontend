import { useEffect, useRef, useState } from "react";

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

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			// Ignore if typing in an input/textarea
			const target = event.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.contentEditable === "true"
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
					return Math.min(current + 1, items.length - 1);
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

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [enabled, items, focusedIndex, onOpen]);

	// Scroll focused row into view
	useEffect(() => {
		if (focusedIndex === null) {
			return;
		}

		const row = document.querySelector(
			`[data-table-row-index="${focusedIndex}"]`,
		) as HTMLElement;
		if (row) {
			row.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
	}, [focusedIndex]);

	// Reset focus when items change
	useEffect(() => {
		setFocusedIndex(null);
	}, [items.length]);

	return {
		focusedIndex,
		focusedId:
			focusedIndex !== null && items[focusedIndex]
				? getId(items[focusedIndex])
				: null,
		tableRef,
	};
}
