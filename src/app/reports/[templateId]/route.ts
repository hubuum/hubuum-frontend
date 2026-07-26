import { NextRequest } from "next/server";

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

		return await renderBookmarkableTemplateReport({
			correlationId: auth.correlationId,
			freshness: parseBookmarkableReportFreshness(
				request.nextUrl.searchParams,
			),
			request: parseBookmarkableReportRequest(request.nextUrl.searchParams),
			sessionId: auth.session.sid,
			templateId: parsedTemplateId,
			token: auth.session.token,
		});
	} catch (error) {
		return rawReportErrorResponse(error, request, auth.session);
	}
}

export function HEAD() {
	return rawReportHeadResponse();
}
