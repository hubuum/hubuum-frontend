export type SearchScope = "collections" | "classes" | "objects";

export const SEARCH_SCOPE_OPTIONS: Array<{
	value: SearchScope;
	label: string;
}> = [
	{ value: "collections", label: "Collections" },
	{ value: "classes", label: "Classes" },
	{ value: "objects", label: "Objects" },
];

export function getSearchPath(scope: SearchScope): string {
	switch (scope) {
		case "collections":
			return "/collections";
		case "classes":
			return "/classes";
		case "objects":
			return "/objects";
	}
}

export function getSearchScopeFromPathname(
	pathname: string,
): SearchScope | null {
	if (pathname === "/collections") {
		return "collections";
	}

	if (pathname === "/classes") {
		return "classes";
	}

	if (pathname === "/objects") {
		return "objects";
	}

	return null;
}

export function normalizeSearchTerm(value: string | null | undefined): string {
	return value?.trim() ?? "";
}

export function matchesFreeTextSearch(
	searchTerm: string,
	...values: Array<string | null | undefined>
): boolean {
	const normalizedSearchTerm =
		normalizeSearchTerm(searchTerm).toLocaleLowerCase();
	if (!normalizedSearchTerm) {
		return true;
	}

	return values.some((value) =>
		value?.toLocaleLowerCase().includes(normalizedSearchTerm),
	);
}
