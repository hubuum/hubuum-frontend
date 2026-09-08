import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireServerSession: vi.fn() }));
vi.mock("@/lib/server-version", () => ({ fetchServerVersion: vi.fn() }));
vi.mock("@/lib/application-version", () => ({
	APPLICATION_VERSION: "v1.2.3-4-gabcdef0-dirty",
}));

import { headers } from "next/headers";
import AboutPage from "@/app/(protected)/about/page";
import { requireServerSession } from "@/lib/auth/guards";
import { CORRELATION_ID_HEADER } from "@/lib/correlation";
import { fetchServerVersion } from "@/lib/server-version";

describe("About page", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(headers).mockResolvedValue(
			new Headers({ [CORRELATION_ID_HEADER]: "about-request" }),
		);
	});

	it("shows frontend and server versions for a signed-in user", async () => {
		vi.mocked(fetchServerVersion).mockResolvedValue("0.0.12");
		const html = renderToStaticMarkup(await AboutPage());
		expect(html).toContain("v1.2.3-4-gabcdef0-dirty");
		expect(html).toContain("<code>0.0.12</code>");
		expect(requireServerSession).toHaveBeenCalledOnce();
		expect(fetchServerVersion).toHaveBeenCalledWith("about-request");
	});

	it("still shows the frontend version when server discovery fails", async () => {
		vi.mocked(fetchServerVersion).mockResolvedValue(null);
		const html = renderToStaticMarkup(await AboutPage());
		expect(html).toContain("v1.2.3-4-gabcdef0-dirty");
		expect(html).toContain("Unavailable");
	});

	it("requires a server session before contacting the backend", async () => {
		vi.mocked(requireServerSession).mockRejectedValue(new Error("redirect"));
		await expect(AboutPage()).rejects.toThrow("redirect");
		expect(fetchServerVersion).not.toHaveBeenCalled();
	});
});
