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
import { ServerTiming } from "@/lib/server-timing";

type RouteContext = {
	params: Promise<{
		taskId: string;
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
		const { taskId } = await context.params;
		const parsedTaskId = /^[1-9]\d*$/.test(taskId)
			? Number.parseInt(taskId, 10)
			: Number.NaN;
		if (!Number.isSafeInteger(parsedTaskId) || parsedTaskId < 1) {
			throw new RawReportError("Task ID must be a positive integer.", 404);
		}

		return finishResponse(
			await getStoredRawReport({
				correlationId: auth.correlationId,
				taskId: parsedTaskId,
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
