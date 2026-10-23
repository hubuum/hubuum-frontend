import { getApiErrorMessage } from "@/lib/api/errors";
import type { PageResult } from "@/lib/api/events";
import {
	getApiV1ClassesByClassIdHistoryTimeline,
	getApiV1ClassesByClassIdByObjectIdHistoryTimeline,
	getApiV1ClassesByClassIdHistoryEntriesByHistoryId,
	getApiV1ClassesByClassIdByObjectIdHistoryEntriesByHistoryId,
	getApiV1ClassesByClassIdRelationsHistoryAsOf,
	getApiV1ClassesByClassIdByObjectIdRelationsHistoryAsOf,
	getApiV1ClassesByClassIdObjectsHistoryAsOf,
	getApiV1ClassesByClassIdByObjectIdHistoryComputedAsOf,
} from "@/lib/api/generated/client";
import type {
	GetApiV1ClassesByClassIdHistoryTimelineParams,
	HistoryResponseHistoryMarker,
	HistoryResponseHubuumClassHistory,
	HistoryResponseHubuumObjectHistory,
} from "@/lib/api/generated/models";
import {
	type HistoryScope,
	historyInstant,
	versionContains,
} from "@/lib/resource-history";

export type ResourceSnapshot =
	| HistoryResponseHubuumClassHistory
	| HistoryResponseHubuumObjectHistory;

function assertScope(
	scope: HistoryScope,
	record: HistoryResponseHistoryMarker,
) {
	if (
		record.id !== (scope.type === "object" ? scope.objectId : scope.classId) ||
		(scope.type === "object"
			? record.hubuum_class_id !== scope.classId
			: record.hubuum_class_id != null) ||
		!Number.isSafeInteger(record.history_id) ||
		record.history_id <= 0 ||
		historyInstant(record.valid_from) === null
	)
		throw new Error("The historical response does not match this resource.");
}

function page<T>(items: T[], headers: Headers): PageResult<T> {
	return { items, nextCursor: headers.get("X-Next-Cursor"), totalCount: null };
}

export async function fetchHistoryTimeline(
	scope: HistoryScope,
	params: GetApiV1ClassesByClassIdHistoryTimelineParams,
	signal?: AbortSignal,
) {
	const options = {
		credentials: "include" as const,
		cache: "no-store" as const,
		signal,
	};
	const query = { ...params, limit: 25, include_total: false };
	const response =
		scope.type === "class"
			? await getApiV1ClassesByClassIdHistoryTimeline(
					scope.classId,
					query,
					options,
				)
			: await getApiV1ClassesByClassIdByObjectIdHistoryTimeline(
					scope.classId,
					scope.objectId,
					query,
					options,
				);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(response.data, "Historical timeline is unavailable."),
		);
	for (const marker of response.data) assertScope(scope, marker);
	return page(response.data, response.headers);
}

export async function fetchHistoryEntry(
	scope: HistoryScope,
	historyId: number,
	signal?: AbortSignal,
): Promise<ResourceSnapshot> {
	const options = {
		credentials: "include" as const,
		cache: "no-store" as const,
		signal,
	};
	const response =
		scope.type === "class"
			? await getApiV1ClassesByClassIdHistoryEntriesByHistoryId(
					scope.classId,
					historyId,
					options,
				)
			: await getApiV1ClassesByClassIdByObjectIdHistoryEntriesByHistoryId(
					scope.classId,
					scope.objectId,
					historyId,
					options,
				);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Historical version is unavailable or inaccessible.",
			),
		);
	assertScope(scope, response.data);
	if (
		response.data.history_id !== historyId ||
		(scope.type === "object"
			? !("data" in response.data)
			: !("validate_schema" in response.data))
	)
		throw new Error(
			"The historical response does not match the requested version.",
		);
	return response.data;
}

export async function fetchHistoricalRelations(
	scope: HistoryScope,
	at: string,
	cursor?: string,
	signal?: AbortSignal,
) {
	const params = { at, cursor, limit: 25, include_total: false };
	const options = { credentials: "include" as const, signal };
	const response =
		scope.type === "class"
			? await getApiV1ClassesByClassIdRelationsHistoryAsOf(
					scope.classId,
					params,
					options,
				)
			: await getApiV1ClassesByClassIdByObjectIdRelationsHistoryAsOf(
					scope.classId,
					scope.objectId,
					params,
					options,
				);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Historical relationships are unavailable.",
			),
		);
	if (
		!response.data.at ||
		historyInstant(response.data.at) !== historyInstant(at) ||
		response.data.coverage !== "retained_history"
	)
		throw new Error("Historical relationships do not match the selected time.");
	for (const record of response.data.relations) {
		const matchesRoot =
			scope.type === "class" && record.kind === "class"
				? [
						record.relation.from_hubuum_class_id,
						record.relation.to_hubuum_class_id,
					].includes(scope.classId)
				: scope.type === "object" &&
					record.kind === "object" &&
					[
						record.relation.from_hubuum_object_id,
						record.relation.to_hubuum_object_id,
					].includes(scope.objectId);
		if (
			!matchesRoot ||
			historyInstant(record.context_at) !== historyInstant(at) ||
			!versionContains(record, at)
		)
			throw new Error(
				"Historical relationships do not match the selected resource and time.",
			);
	}
	return page(response.data.relations, response.headers);
}

export async function fetchHistoricalPopulation(
	classId: number,
	at: string,
	cursor?: string,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdObjectsHistoryAsOf(
		classId,
		{ at, cursor, limit: 25, include_total: false },
		{ credentials: "include", signal },
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Historical object population is unavailable.",
			),
		);
	const data = response.data;
	if (
		historyInstant(data.at) !== historyInstant(at) ||
		data.class.id !== classId ||
		!versionContains(data.class, at) ||
		data.coverage !== "retained_history" ||
		data.objects.some(
			(record) =>
				record.hubuum_class_id !== classId || !versionContains(record, at),
		)
	)
		throw new Error(
			"Historical object population does not match the selected class and time.",
		);
	return { ...page(data.objects, response.headers), classSnapshot: data.class };
}

export async function fetchHistoricalComputed(
	scope: Extract<HistoryScope, { type: "object" }>,
	at: string,
	historyId: number,
	signal?: AbortSignal,
) {
	const response = await getApiV1ClassesByClassIdByObjectIdHistoryComputedAsOf(
		scope.classId,
		scope.objectId,
		{ at },
		{ credentials: "include", signal },
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Historical computed values are unavailable.",
			),
		);
	const data = response.data;
	if (
		historyInstant(data.at) !== historyInstant(at) ||
		data.object.class_id !== scope.classId ||
		data.object.object_id !== scope.objectId ||
		data.object.history_id !== historyId ||
		data.mode !== "historical_recomputation"
	)
		throw new Error(
			"Historical computed values do not match the selected snapshot.",
		);
	return data;
}
