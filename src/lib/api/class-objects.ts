import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import type { HubuumObject } from "@/lib/api/generated/models";

export const CLASS_OBJECT_SAMPLES_STALE_TIME = 5 * 60_000;
export const CLASS_OBJECT_SAMPLES_GC_TIME = 30 * 60_000;

export function classObjectSamplesQueryKey(classId: number | null) {
	return ["class-object-samples", classId] as const;
}

export async function fetchClassObjectSamples(
	classId: number,
	limit = 100,
): Promise<HubuumObject[]> {
	const params = new URLSearchParams({
		include_total: "false",
		limit: String(limit),
		sort: "id.asc",
	});
	const response = await fetch(
		`${frontendApiPath(`/classes/${classId}/objects`)}?${params.toString()}`,
		{ credentials: "include" },
	);
	const payload: unknown = await response.json().catch(() => null);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(payload, "Failed to inspect objects in this class."),
		);
	}
	return expectArrayPayload<HubuumObject>(payload, "class object samples");
}
