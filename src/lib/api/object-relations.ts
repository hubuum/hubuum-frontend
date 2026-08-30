import { collectAllCursorPages } from "@/lib/api/cursor-pages";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1ClassesByClassIdObjectsByObjectIdRelatedObjects,
	getApiV1ClassesByClassIdObjectsByObjectIdRelatedRelations,
} from "@/lib/api/generated/client";
import type {
	GetApiV1ClassesByClassIdObjectsByObjectIdRelatedObjectsParams,
	HubuumObjectRelation,
	HubuumObjectWithPath,
} from "@/lib/api/generated/models";

type RelatedObjectQuery =
	GetApiV1ClassesByClassIdObjectsByObjectIdRelatedObjectsParams & {
		depth__lte: number;
	};

type RelatedObjectOptions = {
	depthLimit: number;
	ignoredClassIds: readonly number[];
	includeSelfClass: boolean;
};

export async function fetchRelatedObjects(
	classId: number,
	objectId: number,
	options: RelatedObjectOptions,
): Promise<HubuumObjectWithPath[]> {
	return collectAllCursorPages(async (cursor) => {
		const params: RelatedObjectQuery = {
			cursor,
			depth__lte: options.depthLimit,
			ignore_classes: options.ignoredClassIds.length
				? options.ignoredClassIds.join(",")
				: undefined,
			ignore_self_class: !options.includeSelfClass,
			include_total: false,
			limit: 250,
			sort: "path.asc,id.asc",
		};
		const response =
			await getApiV1ClassesByClassIdObjectsByObjectIdRelatedObjects(
				classId,
				objectId,
				params,
				{ credentials: "include" },
			);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load related objects."),
			);
		}
		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}

export async function fetchObjectRelations(
	classId: number,
	objectId: number,
): Promise<HubuumObjectRelation[]> {
	return collectAllCursorPages(async (cursor) => {
		const response =
			await getApiV1ClassesByClassIdObjectsByObjectIdRelatedRelations(
				classId,
				objectId,
				{
					cursor,
					include_total: false,
					limit: 250,
					sort: "id.asc",
				},
				{ credentials: "include" },
			);
		if (response.status !== 200) {
			throw new Error(
				getApiErrorMessage(response.data, "Failed to load object relations."),
			);
		}
		return {
			items: response.data,
			nextCursor: response.headers.get("X-Next-Cursor"),
		};
	});
}
