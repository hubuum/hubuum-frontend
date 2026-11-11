import { NextResponse } from "next/server";

import { APPLICATION_VERSION } from "@/lib/application-version";
import { getBackendBaseUrl } from "@/lib/backend-target";
import { checkReadiness } from "@/lib/health";
import { pingValkey } from "@/lib/valkey";

export const dynamic = "force-dynamic";

export async function GET() {
	try {
		const backendBaseUrl = await getBackendBaseUrl();
		const result = await checkReadiness({
			backendBaseUrl,
			pingValkey,
		});

		return NextResponse.json(
			{
				status: result.ready
					? backendBaseUrl
						? "ready"
						: "setup_required"
					: "unavailable",
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
