import { getApiErrorMessage } from "@/lib/api/errors";
import { patchApiV1ClassesByClassIdByObjectIdData } from "@/lib/api/generated/client";
import type {
	HubuumObject,
	ObjectDataPatchDocument,
	ObjectDataPatchDocumentItem,
} from "@/lib/api/generated/models";
import type { ObjectPropertyPathSegment } from "@/lib/object-property-entries";

export const MAX_OBJECT_DATA_PATCH_OPERATIONS = 1_000;

export type ObjectDataPatchChange = {
	operation: "add" | "remove" | "replace";
	path: string;
	previousValue?: unknown;
	nextValue?: unknown;
};

export type ObjectDataPatchPlan = {
	patch: ObjectDataPatchDocument;
	changes: ObjectDataPatchChange[];
	mode: "granular" | "whole-document";
};

function escapeJsonPointerSegment(segment: string): string {
	return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function toObjectDataJsonPointer(
	segments: readonly ObjectPropertyPathSegment[],
): string {
	if (segments.length === 0) return "";
	return `/${segments
		.map((segment) => escapeJsonPointerSegment(String(segment)))
		.join("/")}`;
}

export function buildObjectDataReplacePatch(
	segments: readonly ObjectPropertyPathSegment[],
	currentValue: unknown,
	nextValue: unknown,
): ObjectDataPatchDocument {
	const path = toObjectDataJsonPointer(segments);
	return [
		{ op: "test", path, value: currentValue },
		{ op: "replace", path, value: nextValue },
	];
}

export function buildWholeObjectDataReplacePatch(
	currentData: unknown,
	nextData: unknown,
): ObjectDataPatchDocument {
	return buildObjectDataReplacePatch([], currentData, nextData);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) return true;
	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((item, index) => jsonValuesEqual(item, right[index]))
		);
	}
	if (!isJsonObject(left) || !isJsonObject(right)) return false;

	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every(
			(key, index) =>
				key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
		)
	);
}

export function buildObjectDataPatchPlan(
	currentData: unknown,
	nextData: unknown,
): ObjectDataPatchPlan {
	const tests: ObjectDataPatchDocumentItem[] = [];
	const mutations: ObjectDataPatchDocumentItem[] = [];
	const changes: ObjectDataPatchChange[] = [];
	const guardedAdditionParents = new Set<string>();

	function guardAdditionParent(
		segments: readonly ObjectPropertyPathSegment[],
		currentValue: unknown,
	) {
		const path = toObjectDataJsonPointer(segments);
		if (guardedAdditionParents.has(path)) return;
		guardedAdditionParents.add(path);
		tests.push({ op: "test", path, value: currentValue });
	}

	function collect(
		currentValue: unknown,
		nextValue: unknown,
		segments: readonly ObjectPropertyPathSegment[],
	) {
		if (jsonValuesEqual(currentValue, nextValue)) return;

		if (isJsonObject(currentValue) && isJsonObject(nextValue)) {
			const currentKeys = Object.keys(currentValue).sort();
			const nextKeys = Object.keys(nextValue).sort();
			const currentKeySet = new Set(currentKeys);
			const nextKeySet = new Set(nextKeys);

			for (const key of currentKeys) {
				if (nextKeySet.has(key)) continue;
				const path = toObjectDataJsonPointer([...segments, key]);
				tests.push({ op: "test", path, value: currentValue[key] });
				mutations.push({ op: "remove", path });
				changes.push({
					operation: "remove",
					path,
					previousValue: currentValue[key],
				});
			}

			for (const key of currentKeys) {
				if (!nextKeySet.has(key)) continue;
				collect(currentValue[key], nextValue[key], [...segments, key]);
			}

			for (const key of nextKeys) {
				if (currentKeySet.has(key)) continue;
				guardAdditionParent(segments, currentValue);
				const path = toObjectDataJsonPointer([...segments, key]);
				mutations.push({ op: "add", path, value: nextValue[key] });
				changes.push({
					operation: "add",
					path,
					nextValue: nextValue[key],
				});
			}
			return;
		}

		const path = toObjectDataJsonPointer(segments);
		tests.push({ op: "test", path, value: currentValue });
		mutations.push({ op: "replace", path, value: nextValue });
		changes.push({
			operation: "replace",
			path,
			previousValue: currentValue,
			nextValue,
		});
	}

	collect(currentData, nextData, []);
	const patch = [...tests, ...mutations];
	if (patch.length > MAX_OBJECT_DATA_PATCH_OPERATIONS) {
		return {
			patch: buildWholeObjectDataReplacePatch(currentData, nextData),
			changes,
			mode: "whole-document",
		};
	}

	return { patch, changes, mode: "granular" };
}

export async function patchObjectData(
	classId: number,
	objectId: number,
	patch: ObjectDataPatchDocument,
): Promise<HubuumObject> {
	const response = await patchApiV1ClassesByClassIdByObjectIdData(
		classId,
		objectId,
		patch,
		{ credentials: "include" },
	);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(
				response.data,
				response.status === 409
					? "Object data changed before this edit could be applied. Reload and try again."
					: "Failed to update object data.",
			),
		);
	}
	return response.data;
}
