export type CursorPage<T> = {
	items: T[];
	nextCursor: string | null;
};

export async function collectAllCursorPages<T>(
	loadPage: (cursor?: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
	const items: T[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | undefined;

	while (true) {
		const page = await loadPage(cursor);
		items.push(...page.items);

		if (!page.nextCursor) {
			return items;
		}
		if (seenCursors.has(page.nextCursor)) {
			throw new Error("Cursor pagination returned a repeated next cursor.");
		}

		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
}

export async function findCursorPageItem<T>(
	loadPage: (cursor?: string) => Promise<CursorPage<T>>,
	predicate: (item: T) => boolean,
): Promise<T | null> {
	const seenCursors = new Set<string>();
	let cursor: string | undefined;

	while (true) {
		const page = await loadPage(cursor);
		const match = page.items.find(predicate);
		if (match !== undefined) {
			return match;
		}

		if (!page.nextCursor) {
			return null;
		}
		if (seenCursors.has(page.nextCursor)) {
			throw new Error("Cursor pagination returned a repeated next cursor.");
		}

		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
}
