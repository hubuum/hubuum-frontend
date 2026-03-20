type PaginationEntry = {
	canGoNext: () => boolean;
	canGoPrev: () => boolean;
	canGoFirst: () => boolean;
	onNextPage: () => void;
	onPrevPage: () => void;
	onFirstPage: () => void;
};

const paginationEntries = new Map<string, PaginationEntry>();
let activePaginationId: string | null = null;

function getFirstPaginationId() {
	return paginationEntries.keys().next().value ?? null;
}

export function registerPaginationShortcut(
	id: string,
	entry: PaginationEntry,
): () => void {
	paginationEntries.set(id, entry);
	if (activePaginationId === null) {
		activePaginationId = id;
	}

	return () => {
		paginationEntries.delete(id);
		if (activePaginationId === id) {
			activePaginationId = getFirstPaginationId();
		}
	};
}

export function markPaginationActive(id: string) {
	if (paginationEntries.has(id)) {
		activePaginationId = id;
	}
}

export function triggerActivePaginationNextPage(): boolean {
	if (!activePaginationId || !paginationEntries.has(activePaginationId)) {
		activePaginationId = getFirstPaginationId();
	}

	if (!activePaginationId) {
		return false;
	}

	const entry = paginationEntries.get(activePaginationId);
	if (!entry) {
		return false;
	}

	if (entry.canGoNext()) {
		entry.onNextPage();
		return true;
	}

	if (entry.canGoFirst()) {
		entry.onFirstPage();
		return true;
	}

	return false;
}

export function triggerActivePaginationPrevPage(): boolean {
	if (!activePaginationId || !paginationEntries.has(activePaginationId)) {
		activePaginationId = getFirstPaginationId();
	}

	if (!activePaginationId) {
		return false;
	}

	const entry = paginationEntries.get(activePaginationId);
	if (!entry || !entry.canGoPrev()) {
		return false;
	}

	entry.onPrevPage();
	return true;
}
