import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	getApiV1ClassesByClassIdComputedFieldsByFieldId,
	patchApiV1ClassesByClassIdComputedFieldsByFieldId,
} from "@/lib/api/generated/client";
import { updateComputedField } from "@/lib/api/computed-fields";

vi.mock("@/lib/api/generated/client", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("@/lib/api/generated/client")
	>();
	return {
		...actual,
		getApiV1ClassesByClassIdComputedFieldsByFieldId: vi.fn(),
		patchApiV1ClassesByClassIdComputedFieldsByFieldId: vi.fn(),
	};
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("computed field mutation concurrency", () => {
	it("refreshes the current ETag and sends it with a shared-field update", async () => {
		vi.mocked(getApiV1ClassesByClassIdComputedFieldsByFieldId).mockResolvedValue({
			data: {} as never,
			headers: new Headers({ etag: '"computed-field:5:3"' }),
			status: 200,
		});
		vi.mocked(
			patchApiV1ClassesByClassIdComputedFieldsByFieldId,
		).mockResolvedValue({
			data: { definition: { id: 5 } } as never,
			headers: new Headers(),
			status: 200,
		});

		await expect(
			updateComputedField("shared", 11, 5, { label: "Display name" }),
		).resolves.toMatchObject({ id: 5 });
		expect(
			patchApiV1ClassesByClassIdComputedFieldsByFieldId,
		).toHaveBeenCalledWith(11, 5, { label: "Display name" }, {
			credentials: "include",
			headers: { "If-Match": '"computed-field:5:3"' },
		});
	});
});
