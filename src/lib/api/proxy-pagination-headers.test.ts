import { describe, expect, it } from "vitest";
import { copyPaginationHeaders } from "@/lib/api/proxy-pagination-headers";

describe("copyPaginationHeaders", () => {
	it("forwards the safe cursor and count headers", () => {
		const upstream = new Headers({
			"X-Next-Cursor": "next-page",
			"X-Prev-Cursor": "previous-page",
			"X-Total-Count": "501",
			"X-Page-Limit": "250",
		});
		const response = new Headers();

		copyPaginationHeaders(upstream, response);

		expect(response.get("X-Next-Cursor")).toBe("next-page");
		expect(response.get("X-Prev-Cursor")).toBe("previous-page");
		expect(response.get("X-Total-Count")).toBe("501");
		expect(response.get("X-Page-Limit")).toBe("250");
	});

	it("does not copy unrelated upstream headers", () => {
		const upstream = new Headers({
			Authorization: "Bearer secret",
			"Set-Cookie": "sensitive=value",
		});
		const response = new Headers();

		copyPaginationHeaders(upstream, response);

		expect([...response]).toEqual([]);
	});
});
