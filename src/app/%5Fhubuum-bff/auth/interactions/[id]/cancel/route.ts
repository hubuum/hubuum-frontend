import { NextRequest } from "next/server";
import { cancelBrowserInteraction } from "@/lib/auth/complete-browser-interaction";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	return cancelBrowserInteraction(request, (await context.params).id);
}
