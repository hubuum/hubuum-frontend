import { NextRequest, NextResponse } from "next/server";

import { backendFetchRaw } from "@/lib/api/backend";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { PRIVATE_CACHE_CONTROL } from "@/lib/security-policy";

// Restore completion invalidates bearer sessions. This single read endpoint
// authenticates with the restore capability, which the backend verifies.
export async function GET(
	request: NextRequest,
	context: { params: Promise<{ restoreId: string }> },
) {
	const { restoreId } = await context.params;
	const capability = request.headers.get("X-Hubuum-Restore-Capability");
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const headers = {
		"Cache-Control": PRIVATE_CACHE_CONTROL,
		[CORRELATION_ID_HEADER]: correlationId,
	};
	if (
		!/^[1-9]\d*$/.test(restoreId) ||
		!Number.isSafeInteger(Number(restoreId)) ||
		!capability ||
		capability.length > 1024
	) {
		return NextResponse.json(
			{ message: "A valid restore ID and capability are required." },
			{ status: 400, headers },
		);
	}

	try {
		const upstream = await backendFetchRaw(
			`/api/v1/restores/${restoreId}/status`,
			{
				method: "GET",
				correlationId,
				headers: { "X-Hubuum-Restore-Capability": capability },
				signal: request.signal,
			},
		);
		if (![200, 400, 403].includes(upstream.status)) {
			await upstream.body?.cancel();
			return NextResponse.json(
				{ message: "Restore status is temporarily unavailable. Retrying…" },
				{ status: 502, headers },
			);
		}
		return new NextResponse(upstream.body, {
			status: upstream.status,
			headers: { ...headers, "Content-Type": "application/json" },
		});
	} catch {
		return NextResponse.json(
			{ message: "Restore status is temporarily unavailable. Retrying…" },
			{ status: 502, headers },
		);
	}
}
