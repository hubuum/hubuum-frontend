import { NextRequest, NextResponse } from "next/server";

import { backendFetchRaw } from "@/lib/api/backend";
import { normalizeAuthProvidersResponse } from "@/lib/auth-providers";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

const BACKEND_AUTH_PROVIDERS_PATH = "/api/v0/auth/providers";

function errorResponse(message: string, status: number) {
	return NextResponse.json(
		{ message },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}

export async function GET(request: NextRequest) {
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		undefined;

	try {
		const upstream = await backendFetchRaw(BACKEND_AUTH_PROVIDERS_PATH, {
			correlationId,
			method: "GET",
		});
		if (upstream.status !== 200) {
			const status =
				upstream.status >= 400 && upstream.status <= 599
					? upstream.status
					: 502;
			return errorResponse("Provider discovery is unavailable.", status);
		}

		const payload = normalizeAuthProvidersResponse(
			await upstream.json().catch(() => null),
		);
		if (!payload) {
			return errorResponse(
				"Provider discovery returned an invalid response.",
				502,
			);
		}

		return NextResponse.json(payload, {
			headers: { "Cache-Control": "no-store" },
		});
	} catch {
		return errorResponse("Provider discovery is unavailable.", 503);
	}
}
