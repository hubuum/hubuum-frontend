import type { NextRequest } from "next/server";
import { securityCandidateAction } from "@/lib/auth/security-candidates";

export async function POST(
	request: NextRequest,
	context: { params: Promise<{ id: string }> },
) {
	return securityCandidateAction(
		request,
		(await context.params).id,
		"activate",
	);
}
