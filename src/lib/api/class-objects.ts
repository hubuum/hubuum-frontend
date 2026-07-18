import { expectArrayPayload, getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";
import type { HubuumObject } from "@/lib/api/generated/models";

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
