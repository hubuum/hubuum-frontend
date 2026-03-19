import { useCallback, useRef } from "react";

type UseShiftSelectOptions<T> = {
	items: T[];
	selectedIds: number[];
	setSelectedIds: (ids: number[]) => void;
	getId: (item: T) => number;
};

export function useShiftSelect<T>({
	items,
	selectedIds,
	setSelectedIds,
	getId,
}: UseShiftSelectOptions<T>) {
	const lastClickedIndexRef = useRef<number | null>(null);

	const handleClick = useCallback(
		(itemId: number, checked: boolean, shiftKey: boolean) => {
			const clickedIndex = items.findIndex((item) => getId(item) === itemId);

			if (clickedIndex === -1) {
				return;
			}

			if (!shiftKey || lastClickedIndexRef.current === null) {
				// Normal click - just toggle the item
				if (checked) {
					setSelectedIds(
						selectedIds.includes(itemId)
							? selectedIds
							: [...selectedIds, itemId],
					);
				} else {
					setSelectedIds(selectedIds.filter((id) => id !== itemId));
				}
				lastClickedIndexRef.current = clickedIndex;
				return;
			}

			// Shift+click - select range
			const lastIndex = lastClickedIndexRef.current;
			const start = Math.min(lastIndex, clickedIndex);
			const end = Math.max(lastIndex, clickedIndex);

			const rangeIds = items.slice(start, end + 1).map(getId);

			if (checked) {
				// Add all items in range
				const newIds = new Set([...selectedIds, ...rangeIds]);
				setSelectedIds(Array.from(newIds));
			} else {
				// Remove all items in range
				const idsToRemove = new Set(rangeIds);
				setSelectedIds(selectedIds.filter((id) => !idsToRemove.has(id)));
			}

			lastClickedIndexRef.current = clickedIndex;
		},
		[items, selectedIds, setSelectedIds, getId],
	);

	const handleSelectAll = useCallback(
		(checked: boolean) => {
			if (checked) {
				setSelectedIds(items.map(getId));
			} else {
				setSelectedIds([]);
			}
			lastClickedIndexRef.current = null;
		},
		[items, setSelectedIds, getId],
	);

	return {
		handleClick,
		handleSelectAll,
	};
}
