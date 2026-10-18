import { getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type {
	RelatedClassGraph,
	RelatedObjectGraph,
} from "@/lib/api/generated/models";
import {
	layoutRelatedGraph,
	validateGraphBounds,
	type GraphBounds,
	type GraphScope,
} from "@/lib/related-graph";

export async function fetchRelatedGraph(
	scope: GraphScope,
	bounds: GraphBounds,
	signal?: AbortSignal,
) {
	validateGraphBounds(bounds);
	const resource =
		scope.type === "class"
			? `/classes/${scope.classId}`
			: `/classes/${scope.classId}/objects/${scope.objectId}`;
	const params = new URLSearchParams({
		depth__lte: String(bounds.depth),
		limit: String(bounds.limit),
	});
	const response = await fetch(
		hubuumBffPath(`/api/v1${resource}/related/graph?${params}`),
		{ credentials: "include", signal },
	);
	const data: unknown = await response.json().catch(() => null);
	if (!response.ok)
		throw new Error(
			getApiErrorMessage(
				data,
				"Could not load the neighborhood graph. Check access or reduce the depth or node limit.",
			),
		);
	if (
		!data ||
		typeof data !== "object" ||
		!(scope.type === "class" ? "classes" in data : "objects" in data)
	)
		throw new Error("Invalid neighborhood graph response.");
	return layoutRelatedGraph(
		data as RelatedClassGraph | RelatedObjectGraph,
		scope,
		bounds,
	);
}
