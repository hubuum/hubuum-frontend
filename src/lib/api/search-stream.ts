import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	StructuredSearchRequest,
	StructuredSearchResponse,
	Collection,
	HubuumClassExpanded,
	HubuumObject,
} from "@/lib/api/generated/models";
import { parseStructuredSearchResponse } from "@/lib/api/advanced-search";
import {
	getUnifiedSearchUrl,
	type UnifiedSearchParams,
	type UnifiedSearchResponse,
	type UnifiedSearchKind,
} from "@/lib/api/search";
import { readSearchEventStream } from "@/lib/search-event-stream";
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function streamSignal(signal?: AbortSignal) {
	return AbortSignal.any([
		...(signal ? [signal] : []),
		AbortSignal.timeout(120_000),
	]);
}
export async function streamAdvancedSearch(
	request: StructuredSearchRequest,
	onProgress: (data: StructuredSearchResponse) => void,
	signal?: AbortSignal,
): Promise<StructuredSearchResponse> {
	const cancellation = streamSignal(signal);
	const response = await fetch(hubuumBffPath("/api/v1/search/stream"), {
		method: "POST",
		credentials: "include",
		headers: {
			"Content-Type": "application/json",
			Accept: "text/event-stream",
		},
		body: JSON.stringify(request),
		signal: cancellation,
	});
	let started = false;
	let result: StructuredSearchResponse = {
		version: 1,
		kind: request.target.kind,
		results: [],
		next: null,
		total: null,
	};
	await readSearchEventStream(
		response,
		(event, data) => {
			if (!record(data)) throw new Error("Invalid search stream event.");
			if (event === "error")
				throw new Error(
					typeof data.message === "string"
						? data.message
						: "Search failed during streaming.",
				);
			if (
				event === "started" &&
				!started &&
				data.version === 1 &&
				data.kind === request.target.kind
			) {
				started = true;
				onProgress(result);
				return false;
			}
			if (!started) throw new Error("Search stream did not start correctly.");
			if (event === "result") {
				const parsed = parseStructuredSearchResponse(
					{ version: 1, kind: request.target.kind, results: [data] },
					request.target.kind,
				);
				if (result.results.length >= (request.limit ?? 1000))
					throw new Error("Search stream exceeded the requested result limit.");
				result = { ...result, results: [...result.results, ...parsed.results] };
				onProgress(result);
				return false;
			}
			if (event === "done") {
				if (
					!Number.isSafeInteger(data.page_limit) ||
					Number(data.page_limit) < result.results.length
				)
					throw new Error("Invalid search stream page limit.");
				result = parseStructuredSearchResponse(
					{ ...data, results: result.results },
					request.target.kind,
				);
				return true;
			}
			throw new Error("Unexpected search stream event.");
		},
		cancellation,
	);
	return result;
}
export async function streamUnifiedSearch(
	params: UnifiedSearchParams,
	onProgress: (data: UnifiedSearchResponse) => void,
	signal?: AbortSignal,
): Promise<UnifiedSearchResponse> {
	const cancellation = streamSignal(signal);
	const url = getUnifiedSearchUrl(params).replace(
		"/search?",
		"/search/stream?",
	);
	const response = await fetch(url, {
		credentials: "include",
		headers: { Accept: "text/event-stream" },
		signal: cancellation,
	});
	const kinds = params.kinds?.length
		? params.kinds
		: ["collection", "class", "object"];
	const seen = new Set<string>();
	let started = false;
	let result: UnifiedSearchResponse = {
		query: params.q,
		results: { collections: [], classes: [], objects: [] },
		next: { collections: null, classes: null, objects: null },
	};
	await readSearchEventStream(
		response,
		(event, data) => {
			if (!record(data)) throw new Error("Invalid search stream event.");
			if (event === "error")
				throw new Error(
					typeof data.message === "string"
						? data.message
						: "Search failed during streaming.",
				);
			if (event === "started" && !started && typeof data.query === "string") {
				started = true;
				onProgress(result);
				return false;
			}
			if (!started) throw new Error("Search stream did not start correctly.");
			if (event === "batch") {
				const kind =
					data.kind === "collections"
						? "collection"
						: data.kind === "classes"
							? "class"
							: data.kind === "objects"
								? "object"
								: undefined;
				if (!kind || !kinds.includes(kind) || seen.has(kind))
					throw new Error("Unexpected search stream batch.");
				const group =
					kind === "collection"
						? "collections"
						: kind === "class"
							? "classes"
							: "objects";
				const resources = data[group];
				if (
					!Array.isArray(resources) ||
					resources.length > (params.limitPerKind ?? 1000)
				)
					throw new Error("Invalid search stream result count.");
				parseStructuredSearchResponse(
					{
						version: 1,
						kind,
						results: resources.map((resource) => ({ kind, resource })),
						next: data.next,
					},
					kind,
				);
				seen.add(kind);
				const results = { ...result.results };
				if (kind === "collection")
					results.collections = resources as Collection[];
				else if (kind === "class")
					results.classes = resources as HubuumClassExpanded[];
				else results.objects = resources as HubuumObject[];
				result = {
					...result,
					results,
					next: {
						...result.next,
						[group]: typeof data.next === "string" ? data.next : null,
					},
				};
				onProgress({
					...result,
					next: { collections: null, classes: null, objects: null },
				});
				return false;
			}
			if (
				event === "done" &&
				seen.size === kinds.length &&
				typeof data.query === "string"
			)
				return true;
			throw new Error(
				"Search stream is incomplete or contains an unexpected event.",
			);
		},
		cancellation,
	);
	return result;
}

export async function streamUnifiedSearchKindPage(
	params: UnifiedSearchParams & { kind: UnifiedSearchKind },
) {
	const response = await streamUnifiedSearch(
		{ ...params, kinds: [params.kind] },
		() => undefined,
	);
	switch (params.kind) {
		case "collection":
			return {
				kind: params.kind,
				results: response.results.collections,
				next: response.next.collections,
			};
		case "class":
			return {
				kind: params.kind,
				results: response.results.classes,
				next: response.next.classes,
			};
		case "object":
			return {
				kind: params.kind,
				results: response.results.objects,
				next: response.next.objects,
			};
	}
}
