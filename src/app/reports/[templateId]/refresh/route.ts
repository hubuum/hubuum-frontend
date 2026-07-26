import { NextRequest, NextResponse } from "next/server";

import {
	rawReportErrorResponse,
	rawReportHeadResponse,
	requireRawReportSession,
} from "@/lib/raw-report-route";
import {
	parseBookmarkableReportFreshness,
	parseBookmarkableReportRequest,
	RawReportError,
	renderBookmarkableTemplateReport,
} from "@/lib/server-template-report";

type RouteContext = {
	params: Promise<{
		templateId: string;
	}>;
};

const REPORT_QUERY_PARAMETERS = [
	"query",
	"object_id",
	"missing_data_policy",
	"max_items",
	"max_output_bytes",
	"max_age",
] as const;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, context: RouteContext) {
	const auth = await requireRawReportSession(request);
	if (auth instanceof Response) {
		return auth;
	}

	try {
		const { templateId } = await context.params;
		const parsedTemplateId = /^[1-9]\d*$/.test(templateId)
			? Number.parseInt(templateId, 10)
			: Number.NaN;
		if (!Number.isSafeInteger(parsedTemplateId) || parsedTemplateId < 1) {
			throw new RawReportError("Template ID must be a positive integer.", 404);
		}
		const requestedFreshness = parseBookmarkableReportFreshness(
			request.nextUrl.searchParams,
		);

		const generated = await renderBookmarkableTemplateReport({
			correlationId: auth.correlationId,
			freshness: { maxAgeMilliseconds: 0 },
			request: parseBookmarkableReportRequest(request.nextUrl.searchParams),
			sessionId: auth.session.sid,
			templateId: parsedTemplateId,
			token: auth.session.token,
		});
		await generated.body?.cancel().catch(() => undefined);

		const reportUrl = new URL(`/reports/${parsedTemplateId}`, request.url);
		for (const name of REPORT_QUERY_PARAMETERS) {
			const value = request.nextUrl.searchParams.get(name);
			if (
				value !== null &&
				(name !== "max_age" ||
					requestedFreshness.maxAgeMilliseconds !== 0)
			) {
				reportUrl.searchParams.set(name, value);
			}
		}
		return NextResponse.redirect(reportUrl, 303);
	} catch (error) {
		return rawReportErrorResponse(error, request, auth.session);
	}
}

export function HEAD() {
	return rawReportHeadResponse();
}
