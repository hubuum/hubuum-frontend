import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1ClassesByClassId,
	getApiV1ClassesByClassIdByObjectId,
	getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId,
	getApiV1IamMe,
	patchApiV1ClassesByClassIdByObjectIdData,
} from "@/lib/api/generated/client";
import type { HubuumObject } from "@/lib/api/generated/models";
import { buildObjectRestore, type HistoryScope } from "@/lib/resource-history";

export type LiveHistoryResource = {
	fields: Record<string, unknown>;
	object?: HubuumObject;
	etag: string | null;
	revision: number;
};

export async function fetchHistoryLiveResource(
	scope: HistoryScope,
): Promise<LiveHistoryResource> {
	if (scope.type === "class") {
		const response = await getApiV1ClassesByClassId(scope.classId, {
			credentials: "include",
			cache: "no-store",
		});
		if (response.status !== 200)
			throw new Error(
				getApiErrorMessage(
					response.data,
					"Live class is unavailable or inaccessible.",
				),
			);
		const { name, description, collection_id, validate_schema, json_schema } =
			response.data;
		return {
			fields: {
				name,
				description,
				collection_id,
				validate_schema,
				...(Object.hasOwn(response.data, "json_schema") ? { json_schema } : {}),
			},
			etag: response.headers.get("ETag"),
			revision: response.data.revision,
		};
	}
	const response = await getApiV1ClassesByClassIdByObjectId(
		scope.classId,
		scope.objectId,
		undefined,
		{ credentials: "include", cache: "no-store" },
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Live object is unavailable or inaccessible.",
			),
		);
	const object = response.data as HubuumObject;
	const { name, description, collection_id, hubuum_class_id, data } = object;
	return {
		fields: { name, description, collection_id, hubuum_class_id, data },
		object,
		etag: response.headers.get("ETag"),
		revision: object.revision,
	};
}

export async function canRestoreObject(
	collectionId: number,
	isAdmin: boolean,
): Promise<boolean> {
	if (isAdmin) return true;
	const me = await getApiV1IamMe({ credentials: "include" });
	if (me.status !== 200)
		throw new Error("Unable to check current update permission.");
	const permissions =
		await getApiV1CollectionsByCollectionIdPermissionsEffectivePrincipalByPrincipalId(
			collectionId,
			me.data.principal.principal_id,
			{ credentials: "include" },
		);
	if (permissions.status !== 200)
		throw new Error("Unable to check current update permission.");
	return permissions.data.some(
		(entry) => entry.permission.has_update_object === true,
	);
}

export async function restoreObjectSnapshot(
	scope: Extract<HistoryScope, { type: "object" }>,
	reviewed: LiveHistoryResource,
	historicalData: unknown,
	paths: readonly string[],
): Promise<HubuumObject> {
	if (
		!reviewed.object ||
		reviewed.object.id !== scope.objectId ||
		reviewed.object.hubuum_class_id !== scope.classId
	) {
		throw new Error("The reviewed object does not match the restore target.");
	}
	const plan = buildObjectRestore(reviewed.object.data, historicalData, paths);
	if (plan.patch.length === 0) return reviewed.object;
	const etag =
		reviewed.etag && !reviewed.etag.startsWith("W/") ? reviewed.etag : null;
	const response = await patchApiV1ClassesByClassIdByObjectIdData(
		scope.classId,
		scope.objectId,
		plan.patch,
		{
			credentials: "include",
			...(etag ? { headers: { "If-Match": etag } } : {}),
		},
	);
	if (response.status === 409 || response.status === 412) {
		throw new Error(
			"Live data changed after review. Nothing was restored. Refresh and review the changes again.",
		);
	}
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Restoration failed. Refresh and review current permissions and schema validation before retrying.",
			),
		);
	return response.data;
}
