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
import { ServerTiming } from "@/lib/server-timing";

type RouteContext = {
	params: Promise<{
		templateId: string;
	}>;
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, context: RouteContext) {
	const timing = new ServerTiming();
	const finishTotal = timing.start("total");
	const finishResponse = (response: Response) => {
		finishTotal();
		return timing.attach(response);
	};
	const auth = await timing.measure("session", () =>
		requireRawReportSession(request),
	);
	if (auth instanceof Response) {
		return finishResponse(auth);
	}

	try {
		const { templateId } = await context.params;
		const parsedTemplateId = /^[1-9]\d*$/.test(templateId)
			? Number.parseInt(templateId, 10)
			: Number.NaN;
		if (!Number.isSafeInteger(parsedTemplateId) || parsedTemplateId < 1) {
			throw new RawReportError("Template ID must be a positive integer.", 404);
		}

		return finishResponse(
			await renderBookmarkableTemplateReport({
				correlationId: auth.correlationId,
				freshness: parseBookmarkableReportFreshness(
					request.nextUrl.searchParams,
				),
				request: parseBookmarkableReportRequest(request.nextUrl.searchParams),
				sessionId: auth.session.sid,
				templateId: parsedTemplateId,
				token: auth.session.token,
				dependencies: { timing },
			}),
		);
	} catch (error) {
		return finishResponse(
			await rawReportErrorResponse(error, request, auth.session),
		);
	}
}

export function HEAD() {
	return rawReportHeadResponse();
}
