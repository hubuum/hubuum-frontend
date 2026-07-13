import { NextResponse } from "next/server";

import { APPLICATION_VERSION } from "@/lib/application-version";
import { getServerEnv } from "@/lib/env";
import { checkReadiness } from "@/lib/health";
import { pingValkey } from "@/lib/valkey";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const env = getServerEnv();
		const result = await checkReadiness({
			backendBaseUrl: env.BACKEND_BASE_URL,
			pingValkey,
		});

		return NextResponse.json(
			{
				status: result.ready ? "ready" : "unavailable",
				version: APPLICATION_VERSION,
				dependencies: result.dependencies,
			},
			{
				headers: { "Cache-Control": "no-store" },
				status: result.ready ? 200 : 503,
			},
		);
	} catch {
		return NextResponse.json(
			{
				status: "unavailable",
				version: APPLICATION_VERSION,
				dependencies: { configuration: "error" },
			},
			{ headers: { "Cache-Control": "no-store" }, status: 503 },
		);
	}
}
