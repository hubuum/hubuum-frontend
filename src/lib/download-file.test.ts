import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/download-file";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("file downloads", () => {
	for (const fails of [false, true]) {
		it(`releases its temporary URL and link when a download ${fails ? "fails" : "starts"}`, () => {
			vi.useFakeTimers();
			const blob = new Blob(['{"ids":[1,2,3]}'], { type: "application/json" });
			const createUrl = vi
				.spyOn(URL, "createObjectURL")
				.mockReturnValue("blob:report");
			const revokeUrl = vi
				.spyOn(URL, "revokeObjectURL")
				.mockImplementation(() => {});
			const link = {
				href: "",
				download: "",
				style: { display: "" },
				click: vi.fn(() => {
					if (fails) throw new Error("Download failed");
				}),
				remove: vi.fn(),
			};
			const append = vi.fn();
			vi.stubGlobal("document", {
				createElement: () => link,
				body: { append },
			});
			vi.stubGlobal("window", { setTimeout });
			if (fails)
				expect(() => downloadBlob(blob, "report.json")).toThrow(
					"Download failed",
				);
			else downloadBlob(blob, "report.json");
			expect(createUrl).toHaveBeenCalledWith(blob);
			expect(append).toHaveBeenCalledWith(link);
			expect(link.href).toBe("blob:report");
			expect(link.download).toBe("report.json");
			expect(link.click).toHaveBeenCalledOnce();
			expect(link.remove).toHaveBeenCalledOnce();
			expect(revokeUrl).not.toHaveBeenCalled();
			vi.runAllTimers();
			expect(revokeUrl).toHaveBeenCalledWith("blob:report");
		});
	}
});
