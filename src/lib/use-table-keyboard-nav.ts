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

		const onKeyDown = (event: KeyboardEvent) => {
			// Ignore controls and editable regions.
			const target = event.target as HTMLElement;
			if (
				target.tagName === "INPUT" ||
				target.tagName === "SELECT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "BUTTON" ||
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

		const container = tableRef.current ?? document;
		const row = container.querySelector(
			`[data-table-row-index="${focusedIndex}"]`,
		) as HTMLElement | null;
		if (row) {
			row.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
