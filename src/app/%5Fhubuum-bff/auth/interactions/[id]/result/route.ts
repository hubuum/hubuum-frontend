import { NextRequest } from "next/server";
import { browserInteractionResult } from "@/lib/auth/complete-browser-interaction";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	return browserInteractionResult(request, (await context.params).id);
}
