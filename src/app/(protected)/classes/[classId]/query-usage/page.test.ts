import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
	headers: vi.fn(
		async () => new Headers({ "x-correlation-id": "query-usage-test" }),
	),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("not found");
	},
}));
vi.mock("@/components/class-query-usage-workspace", () => ({
	ClassQueryUsageWorkspace: () => null,
}));
vi.mock("@/lib/auth/guards", () => ({ requireServerSession: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ hasAdminAccess: vi.fn() }));

import Page from "@/app/(protected)/classes/[classId]/query-usage/page";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";

describe("query usage page boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireServerSession).mockResolvedValue({
			token: "server-token",
		} as Awaited<ReturnType<typeof requireServerSession>>);
	});
	it.each([true, false])(
		"passes only the server's analysis visibility decision (%s)",
		async (allowed) => {
			vi.mocked(hasAdminAccess).mockResolvedValue(allowed);
			const page = await Page({ params: Promise.resolve({ classId: "10" }) });
			expect(page.props).toEqual({ classId: 10, canAnalyze: allowed });
			expect(hasAdminAccess).toHaveBeenCalledWith(
				"server-token",
				"query-usage-test",
			);
		},
	);
	it("requires a session before probing administrative access", async () => {
		vi.mocked(requireServerSession).mockRejectedValueOnce(
			new Error("redirect"),
		);
		await expect(
			Page({ params: Promise.resolve({ classId: "10" }) }),
		).rejects.toThrow("redirect");
		expect(hasAdminAccess).not.toHaveBeenCalled();
	});
	it.each(["0", "-1", "1junk", "1.5", "9007199254740992"])(
		"rejects invalid class id %s",
		async (classId) => {
			await expect(
				Page({ params: Promise.resolve({ classId }) }),
			).rejects.toThrow("not found");
			expect(hasAdminAccess).not.toHaveBeenCalled();
		},
	);
});
