import type { NextRequest } from "next/server";
import { securityCandidateAction } from "@/lib/auth/security-candidates";

export async function GET(
	request: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	return securityCandidateAction(request, (await context.params).id, "report");
}

export async function DELETE(
	request: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	return securityCandidateAction(request, (await context.params).id, "discard");
}
