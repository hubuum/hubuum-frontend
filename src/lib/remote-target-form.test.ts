import { describe, expect, it } from "vitest";
import type { RemoteTarget } from "@/lib/api/generated/models";
import {
	buildRemoteTargetPayload,
	defaultRemoteTargetFormState,
	formatRemoteTargetSubjectTypes,
	remoteTargetFormStateFromTarget,
	type RemoteTargetFormState,
} from "@/lib/remote-target-form";

function makeTarget(overrides: Partial<RemoteTarget> = {}): RemoteTarget {
	return {
		allowed_subject_types: ["object"],
		auth_config: { type: "none" },
		class_id: 20,
		collection_id: 10,
		created_at: "2026-08-08T10:00:00.000Z",
		description: "Create an external ticket",
		enabled: true,
		headers_template: {},
		id: 1,
		method: "post",
		name: "create-ticket",
		revision: 1,
		timeout_ms: 5000,
		updated_at: "2026-08-08T10:00:00.000Z",
		url_template: "https://example.com/{{ object.id }}",
		...overrides,
	};
}

function validFormState(
	overrides: Partial<RemoteTargetFormState> = {},
): RemoteTargetFormState {
	return {
		...defaultRemoteTargetFormState,
		allowedSubjectTypes: [...defaultRemoteTargetFormState.allowedSubjectTypes],
		classId: "20",
		collectionId: "10",
		description: "Create an external ticket",
		name: "create-ticket",
		...overrides,
	};
}

describe("remote target form", () => {
	it("preserves every allowed subject type when editing another field", () => {
		const allowedSubjectTypes = [
			"collection",
			"object",
			"class_relation",
		] as const;
		const state = remoteTargetFormStateFromTarget(
			makeTarget({ allowed_subject_types: [...allowedSubjectTypes] }),
		);

		const payload = buildRemoteTargetPayload({
			...state,
			description: "Updated description",
		});

		expect(payload.description).toBe("Updated description");
		expect(payload.allowed_subject_types).toEqual(allowedSubjectTypes);
	});

	it("requires a class scope whenever object is one of several subjects", () => {
		expect(() =>
			buildRemoteTargetPayload(
				validFormState({
					allowedSubjectTypes: ["collection", "object"],
					classId: "",
				}),
			),
		).toThrow("Class scope is required for object targets.");

		expect(
			buildRemoteTargetPayload(
				validFormState({
					allowedSubjectTypes: ["collection", "object"],
				}),
			).class_id,
		).toBe(20);
	});

	it("rejects a class scope when object is not selected", () => {
		expect(() =>
			buildRemoteTargetPayload(
				validFormState({
					allowedSubjectTypes: ["collection", "class"],
				}),
			),
		).toThrow("Class scope is only valid for object targets.");
	});

	it("requires at least one subject type", () => {
		expect(() =>
			buildRemoteTargetPayload(
				validFormState({ allowedSubjectTypes: [], classId: "" }),
			),
		).toThrow("Select at least one subject type.");
	});

	it("formats the complete subject set for review", () => {
		expect(
			formatRemoteTargetSubjectTypes([
				"collection",
				"object",
				"object_relation",
			]),
		).toBe("collection, object, object relation");
	});
});
