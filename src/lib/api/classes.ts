import { getApiErrorMessage } from "@/lib/api/errors";
import { hubuumBffPath } from "@/lib/api/frontend";
import type { HubuumClassExpanded } from "@/lib/api/generated/models";

export async function fetchExpandedClass(
	classId: number,
): Promise<HubuumClassExpanded> {
	const response = await fetch(
		`${hubuumBffPath(`/api/v1/classes/${classId}`)}?include=collection`,
		{ credentials: "include" },
	);
	const text = await response.text();
	let payload: unknown = null;
	if (text) {
		try {
			payload = JSON.parse(text) as unknown;
		} catch {
			payload = text;
		}
	}

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(payload, "Failed to load class."));
	}
	if (
		!payload ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		!("collection" in payload)
	) {
		throw new Error("The server returned a class without collection context.");
	}

	return payload as HubuumClassExpanded;
}
