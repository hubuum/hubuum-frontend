export type SearchScope = "namespaces" | "classes" | "objects";

export const SEARCH_SCOPE_OPTIONS: Array<{
	value: SearchScope;
	label: string;
}> = [
	{ value: "namespaces", label: "Namespaces" },
	{ value: "classes", label: "Classes" },
	{ value: "objects", label: "Objects" },
];

export function getSearchPath(scope: SearchScope): string {
	switch (scope) {
		case "namespaces":
			return "/namespaces";
		case "classes":
			return "/classes";
		case "objects":
			return "/objects";
	}
}

export function getSearchScopeFromPathname(
	pathname: string,
): SearchScope | null {
	if (pathname === "/namespaces") {
		return "namespaces";
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
