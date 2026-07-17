import { getApiErrorMessage } from "@/lib/api/errors";
import {
	deleteApiV1ClassesByClassIdComputedFieldsByFieldId,
	deleteApiV1IamMeComputedFieldsByFieldId,
	getApiV1ClassesByClassIdComputedFields,
	getApiV1IamMeComputedFields,
	patchApiV1ClassesByClassIdComputedFieldsByFieldId,
	patchApiV1IamMeComputedFieldsByFieldId,
	postApiV1ClassesByClassIdComputedFields,
	postApiV1ClassesByClassIdComputedFieldsPreview,
	postApiV1ClassesByClassIdComputedFieldsRebuild,
	postApiV1IamMeComputedFields,
	postApiV1IamMeComputedFieldsPreview,
} from "@/lib/api/generated/client";
import type {
	ClassComputationState,
	ComputedFieldDefinition,
	ComputedFieldDefinitionPatch,
	ComputedFieldDefinitionRequest,
	ComputedFieldListResponse,
	ComputedFieldPreviewRequest,
	ComputedFieldPreviewResponse,
	ComputedResultType,
} from "@/lib/api/generated/models";

export type ComputedFieldScope = "shared" | "personal";
export type ComputedOperationType =
	| "first_non_null"
	| "sum"
	| "average"
	| "min"
	| "max"
	| "all_present"
	| "any_present"
	| "count_present"
	| "all_present_and_equal";

export type ComputedFieldDraft = {
	description: string;
	enabled: boolean;
	key: string;
	label: string;
	operationType: ComputedOperationType;
	pathsText: string;
	resultType: ComputedResultType;
};

export const EMPTY_COMPUTED_FIELD_DRAFT: ComputedFieldDraft = {
	description: "",
	enabled: true,
	key: "",
	label: "",
	operationType: "first_non_null",
	pathsText: "",
	resultType: "string",
};

export function pathsFromText(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((path) => path.trim())
		.filter(Boolean)
		.map((path) => (path === "<root>" ? "" : path));
}

export function draftFromDefinition(
	definition: ComputedFieldDefinition,
): ComputedFieldDraft {
	const operation = definition.operation as {
		paths?: unknown;
		type?: unknown;
	};
	const paths = Array.isArray(operation.paths)
		? operation.paths.filter((path): path is string => typeof path === "string")
		: [];
	return {
		description: definition.description,
		enabled: definition.enabled,
		key: definition.key,
		label: definition.label,
		operationType:
			typeof operation.type === "string"
				? (operation.type as ComputedOperationType)
				: "first_non_null",
		pathsText: paths.map((path) => (path === "" ? "<root>" : path)).join("\n"),
		resultType: definition.result_type as ComputedResultType,
	};
}

export function definitionRequestFromDraft(
	draft: ComputedFieldDraft,
): ComputedFieldDefinitionRequest {
	const key = draft.key.trim();
	const label = draft.label.trim();
	const paths = pathsFromText(draft.pathsText);
	if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
		throw new Error("Key must match [a-z][a-z0-9_]{0,63}.");
	}
	if (!label) {
		throw new Error("Label is required.");
	}
	const minimumPaths = draft.operationType === "all_present_and_equal" ? 2 : 1;
	if (paths.length < minimumPaths || paths.length > 16) {
		throw new Error(
			`Operation requires between ${minimumPaths} and 16 JSON Pointer paths.`,
		);
	}
	if (new Set(paths).size !== paths.length) {
		throw new Error("JSON Pointer paths must be unique.");
	}
	for (const path of paths) {
		if (path !== "" && !path.startsWith("/")) {
			throw new Error(`JSON Pointer must start with "/": ${path}`);
		}
	}

	const numeric = ["sum", "average", "min", "max"].includes(
		draft.operationType,
	);
	const boolean = [
		"all_present",
		"any_present",
		"all_present_and_equal",
	].includes(draft.operationType);
	if (
		numeric &&
		draft.resultType !== "number" &&
		draft.resultType !== "integer"
	) {
		throw new Error("Numeric operations require a number or integer result.");
	}
	if (
		draft.operationType === "count_present" &&
		draft.resultType !== "integer"
	) {
		throw new Error("Count present requires an integer result.");
	}
	if (boolean && draft.resultType !== "boolean") {
		throw new Error("Presence operations require a boolean result.");
	}

	return {
		description: draft.description.trim(),
		enabled: draft.enabled,
		key,
		label,
		operation: { type: draft.operationType, paths },
		result_type: draft.resultType,
	};
}

function assertStatus(
	status: number,
	data: unknown,
	expected: number | readonly number[],
	fallback: string,
): void {
	const accepted = Array.isArray(expected) ? expected : [expected];
	if (!accepted.includes(status)) {
		throw new Error(getApiErrorMessage(data, fallback));
	}
}

export async function fetchSharedComputedFields(
	classId: number,
): Promise<ComputedFieldListResponse> {
	const response = await getApiV1ClassesByClassIdComputedFields(classId, {
		credentials: "include",
	});
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load shared computed fields.",
	);
	return response.data as ComputedFieldListResponse;
}

export async function fetchPersonalComputedFields(
	classId: number,
): Promise<ComputedFieldDefinition[]> {
	const response = await getApiV1IamMeComputedFields(
		{ class_id: classId },
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to load personal computed fields.",
	);
	return response.data as ComputedFieldDefinition[];
}

export async function createComputedField(
	scope: ComputedFieldScope,
	classId: number,
	request: ComputedFieldDefinitionRequest,
): Promise<ComputedFieldDefinition> {
	if (scope === "shared") {
		const response = await postApiV1ClassesByClassIdComputedFields(
			classId,
			request,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			201,
			"Failed to create shared computed field.",
		);
		return (response.data as { definition: ComputedFieldDefinition })
			.definition;
	}

	const response = await postApiV1IamMeComputedFields(
		{ class_id: classId, ...request },
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		201,
		"Failed to create personal computed field.",
	);
	return response.data as ComputedFieldDefinition;
}

export async function updateComputedField(
	scope: ComputedFieldScope,
	classId: number,
	definitionId: number,
	patch: ComputedFieldDefinitionPatch,
): Promise<ComputedFieldDefinition> {
	if (scope === "shared") {
		const response = await patchApiV1ClassesByClassIdComputedFieldsByFieldId(
			classId,
			definitionId,
			patch,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to update shared computed field.",
		);
		return (response.data as { definition: ComputedFieldDefinition })
			.definition;
	}

	const response = await patchApiV1IamMeComputedFieldsByFieldId(
		definitionId,
		patch,
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to update personal computed field.",
	);
	return response.data as ComputedFieldDefinition;
}

export async function deleteComputedField(
	scope: ComputedFieldScope,
	classId: number,
	definition: Pick<ComputedFieldDefinition, "id" | "revision">,
): Promise<void> {
	if (scope === "shared") {
		const response = await deleteApiV1ClassesByClassIdComputedFieldsByFieldId(
			classId,
			definition.id,
			{ expected_revision: definition.revision },
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			202,
			"Failed to delete shared computed field.",
		);
		return;
	}

	const response = await deleteApiV1IamMeComputedFieldsByFieldId(
		definition.id,
		{ expected_revision: definition.revision },
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		204,
		"Failed to delete personal computed field.",
	);
}

export async function previewComputedField(
	scope: ComputedFieldScope,
	classId: number,
	request: ComputedFieldPreviewRequest,
): Promise<ComputedFieldPreviewResponse> {
	if (scope === "shared") {
		const response = await postApiV1ClassesByClassIdComputedFieldsPreview(
			classId,
			request,
			{ credentials: "include" },
		);
		assertStatus(
			response.status,
			response.data,
			200,
			"Failed to preview shared computed field.",
		);
		return response.data as ComputedFieldPreviewResponse;
	}

	const response = await postApiV1IamMeComputedFieldsPreview(
		{ ...request, class_id: classId },
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		200,
		"Failed to preview personal computed field.",
	);
	return response.data as ComputedFieldPreviewResponse;
}

export async function rebuildSharedComputedFields(
	classId: number,
): Promise<ClassComputationState> {
	const response = await postApiV1ClassesByClassIdComputedFieldsRebuild(
		classId,
		{ credentials: "include" },
	);
	assertStatus(
		response.status,
		response.data,
		202,
		"Failed to rebuild shared computed fields.",
	);
	return response.data as ClassComputationState;
}
