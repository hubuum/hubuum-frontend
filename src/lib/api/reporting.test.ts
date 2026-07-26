import { beforeEach, describe, expect, it, vi } from "vitest";

const getTemplateHistory = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/generated/client", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("@/lib/api/generated/client")
	>()),
	getApiV1ExportTemplatesByTemplateIdHistory: getTemplateHistory,
}));

import { listReportTemplateHistory } from "@/lib/api/reporting";

describe("listReportTemplateHistory", () => {
	beforeEach(() => {
		getTemplateHistory.mockReset();
		getTemplateHistory.mockResolvedValue({
			data: [],
			headers: new Headers(),
			status: 200,
		});
	});

	it("orders versions by the server-supported descending history id", async () => {
		await expect(listReportTemplateHistory(42)).resolves.toEqual([]);

		expect(getTemplateHistory).toHaveBeenCalledWith(
			42,
			{ include_total: false, limit: 50, sort: "-history_id" },
			{ credentials: "include" },
		);
	});
});
