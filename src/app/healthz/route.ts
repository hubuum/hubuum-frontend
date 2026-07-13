import { NextResponse } from "next/server";

import { APPLICATION_VERSION } from "@/lib/application-version";

export const dynamic = "force-dynamic";

export function GET() {
	return NextResponse.json(
		{ status: "ok", version: APPLICATION_VERSION },
		{ headers: { "Cache-Control": "no-store" } },
	);
}
