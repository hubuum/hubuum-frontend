import { NextRequest } from "next/server";

import {
	rawReportErrorResponse,
	rawReportHeadResponse,
	requireRawReportSession,
} from "@/lib/raw-report-route";
import {
	getStoredRawReport,
	RawReportError,
} from "@/lib/server-template-report";

type RouteContext = {
	params: Promise<{
		taskId: string;
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
		const { taskId } = await context.params;
		const parsedTaskId = /^[1-9]\d*$/.test(taskId)
			? Number.parseInt(taskId, 10)
			: Number.NaN;
		if (!Number.isSafeInteger(parsedTaskId) || parsedTaskId < 1) {
			throw new RawReportError("Task ID must be a positive integer.", 404);
		}

		return await getStoredRawReport({
			correlationId: auth.correlationId,
			taskId: parsedTaskId,
			token: auth.session.token,
		});
	} catch (error) {
		return rawReportErrorResponse(error, request, auth.session);
	}
}

export function HEAD() {
	return rawReportHeadResponse();
}
