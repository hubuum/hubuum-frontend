import { getApiErrorMessage } from "@/lib/api/errors";
import type {
	HubuumClassExpanded,
	HubuumObject,
	Namespace,
} from "@/lib/api/generated/models";

export type UnifiedSearchKind = "namespace" | "class" | "object";
export type UnifiedSearchGroup = "namespaces" | "classes" | "objects";

export type UnifiedSearchResults = {
	namespaces: Namespace[];
	classes: HubuumClassExpanded[];
	objects: HubuumObject[];
};

export type UnifiedSearchNext = {
	namespaces: string | null;
	classes: string | null;
	objects: string | null;
};

export type UnifiedSearchResponse = {
	query: string;
	results: UnifiedSearchResults;
	next: UnifiedSearchNext;
};

export type UnifiedSearchParams = {
	q: string;
	kinds?: UnifiedSearchKind[];
	limitPerKind?: number;
	cursorNamespaces?: string | null;
	cursorClasses?: string | null;
	cursorObjects?: string | null;
	searchClassSchema?: boolean;
	searchObjectData?: boolean;
};

export type UnifiedSearchKindPage =
	| {
			kind: "namespace";
			results: Namespace[];
			next: string | null;
	  }
	| {
			kind: "class";
			results: HubuumClassExpanded[];
			next: string | null;
	  }
	| {
			kind: "object";
			results: HubuumObject[];
			next: string | null;
	  };

export const DEFAULT_UNIFIED_SEARCH_LIMIT = 10;

function emptyResults(): UnifiedSearchResults {
	return {
		namespaces: [],
		classes: [],
		objects: [],
	};
}

function emptyNext(): UnifiedSearchNext {
	return {
		namespaces: null,
		classes: null,
		objects: null,
	};
}

function parseJsonPayload(text: string): unknown {
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function normalizeSearchResponse(
	payload: unknown,
	fallbackQuery: string,
): UnifiedSearchResponse {
	if (!payload || typeof payload !== "object") {
		throw new Error("Unexpected response format for unified search.");
	}

	const response = payload as {
		query?: unknown;
		results?: {
			namespaces?: unknown;
			classes?: unknown;
			objects?: unknown;
		};
		next?: {
			namespaces?: unknown;
			classes?: unknown;
			objects?: unknown;
		};
	};

	return {
		query: typeof response.query === "string" ? response.query : fallbackQuery,
		results: {
			namespaces: Array.isArray(response.results?.namespaces)
				? (response.results.namespaces as Namespace[])
				: [],
			classes: Array.isArray(response.results?.classes)
				? (response.results.classes as HubuumClassExpanded[])
				: [],
			objects: Array.isArray(response.results?.objects)
				? (response.results.objects as HubuumObject[])
				: [],
		},
		next: {
			namespaces:
				typeof response.next?.namespaces === "string"
					? response.next.namespaces
					: null,
			classes:
				typeof response.next?.classes === "string"
					? response.next.classes
					: null,
			objects:
				typeof response.next?.objects === "string"
					? response.next.objects
					: null,
		},
	};
}

export function getUnifiedSearchUrl(params: UnifiedSearchParams): string {
	const normalizedParams = new URLSearchParams();
	normalizedParams.set("q", params.q);

	if (params.kinds && params.kinds.length > 0) {
		normalizedParams.set("kinds", params.kinds.join(","));
	}

	if (typeof params.limitPerKind === "number") {
		normalizedParams.set("limit_per_kind", String(params.limitPerKind));
	}

	if (params.cursorNamespaces) {
		normalizedParams.set("cursor_namespaces", params.cursorNamespaces);
	}

	if (params.cursorClasses) {
		normalizedParams.set("cursor_classes", params.cursorClasses);
	}

	if (params.cursorObjects) {
		normalizedParams.set("cursor_objects", params.cursorObjects);
	}

	if (params.searchClassSchema) {
		normalizedParams.set("search_class_schema", "true");
	}

	if (params.searchObjectData) {
		normalizedParams.set("search_object_data", "true");
	}

	const query = normalizedParams.toString();
	return query ? `/_hubuum-bff/hubuum/api/v1/search?${query}` : "/_hubuum-bff/hubuum/api/v1/search";
}

export async function fetchUnifiedSearch(
	params: UnifiedSearchParams,
	options?: RequestInit,
): Promise<UnifiedSearchResponse> {
	const response = await fetch(getUnifiedSearchUrl(params), {
		credentials: "include",
		...options,
		method: "GET",
	});
	const payload = parseJsonPayload(await response.text());

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to run unified search."),
		);
	}

	return normalizeSearchResponse(payload, params.q);
}

export async function fetchUnifiedSearchKindPage(
	params: Omit<UnifiedSearchParams, "kinds"> & { kind: UnifiedSearchKind },
): Promise<UnifiedSearchKindPage> {
	const response = await fetchUnifiedSearch({
		q: params.q,
		kinds: [params.kind],
		limitPerKind: params.limitPerKind,
		cursorNamespaces: params.cursorNamespaces,
		cursorClasses: params.cursorClasses,
		cursorObjects: params.cursorObjects,
		searchClassSchema: params.searchClassSchema,
		searchObjectData: params.searchObjectData,
	});

	switch (params.kind) {
		case "namespace":
			return {
				kind: "namespace",
				results: response.results.namespaces,
				next: response.next.namespaces,
			};
		case "class":
			return {
				kind: "class",
				results: response.results.classes,
				next: response.next.classes,
			};
		case "object":
			return {
				kind: "object",
				results: response.results.objects,
				next: response.next.objects,
			};
	}
}

export function createEmptyUnifiedSearchResults(): UnifiedSearchResults {
	return emptyResults();
}

export function createEmptyUnifiedSearchNext(): UnifiedSearchNext {
	return emptyNext();
}
