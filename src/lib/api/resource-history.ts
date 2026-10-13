import { getApiErrorMessage } from "@/lib/api/errors";
import {
	fetchResourceHistoryAsOf,
	type ResourceEventScope,
} from "@/lib/api/events";
import {
	getApiV1ClassesByClassId,
	getApiV1ClassesByClassIdByObjectId,
	getApiV1CollectionsByCollectionId,
	patchApiV1ClassesByClassId,
	patchApiV1ClassesByClassIdByObjectIdData,
} from "@/lib/api/generated/client";
import type {
	HubuumClass,
	HubuumClassHistory,
	HubuumObject,
} from "@/lib/api/generated/models";
import {
	buildClassRestore,
	buildObjectRestore,
	type HistoryScope,
	versionContains,
} from "@/lib/resource-history";

export async function fetchHistoricalContext(
	scope: Exclude<ResourceEventScope, { type: "object" }>,
	at: string,
) {
	const record = await fetchResourceHistoryAsOf(scope, at);
	const id = scope.type === "class" ? scope.classId : scope.collectionId;
	const matchesType =
		scope.type === "class"
			? "validate_schema" in record
			: !("collection_id" in record);
	if (record.id !== id || !matchesType || !versionContains(record, at))
		throw new Error("Historical context is unavailable at this time.");
	return record;
}

export type LiveHistoryResource = {
	fields: Record<string, unknown>;
	object?: HubuumObject;
	classDefinition?: HubuumClass;
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
			classDefinition: response.data,
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

function classRestorePlan(
	classId: number,
	reviewed: LiveHistoryResource,
	source: HubuumClassHistory,
	fields: readonly string[],
) {
	if (!reviewed.classDefinition || reviewed.classDefinition.id !== classId)
		throw new Error("The reviewed class does not match the restore target.");
	if (!reviewed.etag || !/^"[^"\r\n]+"$/.test(reviewed.etag))
		throw new Error(
			"This server did not provide a strong revision validator. Class restoration is unavailable.",
		);
	return {
		...buildClassRestore(reviewed.classDefinition, source, fields),
		etag: reviewed.etag,
	};
}

export async function reviewClassRestore(
	classId: number,
	reviewed: LiveHistoryResource,
	source: HubuumClassHistory,
	fields: readonly string[],
) {
	const plan = classRestorePlan(classId, reviewed, source, fields);
	if (
		plan.patch.collection_id != null &&
		plan.patch.collection_id !== reviewed.classDefinition?.collection_id
	) {
		const target = await getApiV1CollectionsByCollectionId(
			plan.patch.collection_id,
			{
				credentials: "include",
				cache: "no-store",
			},
		);
		// ReadCollection is separate from the CreateClass permission needed to
		// move here. Let PATCH check move access when collection reads are denied.
		if (![200, 403].includes(target.status))
			throw new Error(
				"The historical collection is deleted or inaccessible. No fields will be restored.",
			);
	}
	return plan;
}

export async function restoreClassSnapshot(
	classId: number,
	reviewed: LiveHistoryResource,
	source: HubuumClassHistory,
	fields: readonly string[],
): Promise<void> {
	const plan = classRestorePlan(classId, reviewed, source, fields);
	if (!plan.changes.length) return;
	// The conditional PATCH checks current update and destination permissions on
	// every permission backend; optional collection grant provenance cannot.
	const response = await patchApiV1ClassesByClassId(classId, plan.patch, {
		credentials: "include",
		headers: { "If-Match": plan.etag },
	});
	if (response.status === 412)
		throw new Error(
			"The class changed after review. Nothing was restored. Refresh and review again.",
		);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Class restoration failed. Refresh and review again.",
			),
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
	// The PATCH authorizes UpdateObject on every permission backend. Collection
	// grant provenance is optional and cannot determine object update access.
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
