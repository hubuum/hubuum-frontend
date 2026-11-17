import { type NextRequest, NextResponse } from "next/server";
import { completeBrowserInteraction } from "@/lib/auth/complete-browser-interaction";
import { authenticationReason } from "@/lib/browser-authentication";

export async function GET(request: NextRequest) {
	const response = await completeBrowserInteraction(request);
	if (
		response.status < 400 ||
		!request.headers.get("accept")?.includes("text/html")
	)
		return response;
	const payload: unknown = await response
		.clone()
		.json()
		.catch(() => null);
	const reason =
		authenticationReason(
			payload && typeof payload === "object" && "reason" in payload
				? payload.reason
				: null,
		) ?? "interaction_failed";
	const headers = new Headers(response.headers);
	headers.delete("Content-Type");
	headers.delete("Content-Length");
	headers.set("Location", `/authentication/complete?error=${reason}`);
	return new NextResponse(null, { status: 303, headers });
}
