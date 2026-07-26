import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1ClassesByClassIdRelatedClasses } from "@/lib/api/generated/client";
import type { HubuumClassWithPath } from "@/lib/api/generated/models";

export function relatedClassPathsQueryKey(classId: number | null) {
	return ["related-class-paths", classId] as const;
}

export async function fetchRelatedClassPaths(
	classId: number,
): Promise<HubuumClassWithPath[]> {
	return collectAllCursorPages(async (cursor) => {
		const response = await getApiV1ClassesByClassIdRelatedClasses(
			classId,
			{
				cursor,
				include_total: false,
				limit: 250,
				sort: "path.asc,id.asc",
			},
			{ credentials: "include" },
		);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(
					response.data,
					"Failed to load related class paths.",
				),
			);
		}
		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}
