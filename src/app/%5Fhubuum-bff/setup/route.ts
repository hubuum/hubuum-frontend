import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { inspectBackend } from "@/lib/backend-discovery";
import {
	backendCheckSchema,
	type BackendCheck,
	normalizeBackendOrigin,
} from "@/lib/backend-setup";
import {
	getBackendBaseUrl,
	getSetupKey,
	saveInitialBackend,
} from "@/lib/backend-target";
import { rejectCrossOriginBffMutation } from "@/lib/bff-request-origin";
import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";

const requestSchema = z.object({
	action: z.enum(["check", "save"]),
	url: z.string().min(1).max(2048),
	confirmation: backendCheckSchema.optional(),
});

export async function POST(request: NextRequest) {
	const originRejection = rejectCrossOriginBffMutation(request);
	if (originRejection) return originRejection;
	const correlationId =
		normalizeCorrelationId(request.headers.get(CORRELATION_ID_HEADER)) ??
		generateCorrelationId();
	const reply = (status: number, body: object) =>
		NextResponse.json(body, {
			status,
			headers: {
				"Cache-Control": "no-store",
				[CORRELATION_ID_HEADER]: correlationId,
			},
		});
	try {
		if (await getBackendBaseUrl())
			return reply(409, {
				message: "This installation already has a backend. Reload to sign in.",
			});
		const setupKey = await getSetupKey();
		if (!setupKey)
			return reply(503, {
				message:
					"The setup key is unavailable. Check the frontend startup output or restart the frontend.",
			});
		const key = request.headers.get("x-hubuum-setup-key") ?? "";
		const digest = (value: string) =>
			createHash("sha256").update(value).digest();
		if (key.length > 256 || !timingSafeEqual(digest(key), digest(setupKey))) {
			return reply(403, { message: "The setup key is incorrect." });
		}
		const parsed = requestSchema.safeParse(
			await request.json().catch(() => null),
		);
		if (!parsed.success)
			return reply(400, { message: "Enter a valid server URL." });
		let origin: string;
		try {
			origin = normalizeBackendOrigin(parsed.data.url);
		} catch (error) {
			return reply(400, {
				message: error instanceof Error ? error.message : "Invalid server URL.",
			});
		}
		let check: BackendCheck;
		try {
			check = { ...(await inspectBackend(origin, correlationId)), origin };
		} catch (error) {
			return reply(422, {
				message:
					error instanceof Error
						? error.message
						: "The server could not be verified.",
			});
		}
		if (
			parsed.data.action === "save" &&
			check.compatibility !== "supported" &&
			JSON.stringify(parsed.data.confirmation) !== JSON.stringify(check)
		) {
			return reply(409, {
				...check,
				saved: false,
				message:
					"Review the current compatibility warnings and confirm that you want to continue anyway.",
			});
		}
		if (parsed.data.action === "save" && !(await saveInitialBackend(origin))) {
			return reply(409, {
				message: "Another setup completed first. Reload to sign in.",
			});
		}
		return reply(200, {
			...check,
			saved: parsed.data.action === "save",
		});
	} catch {
		return reply(503, {
			message:
				"Setup is unavailable. Check the frontend configuration and Valkey connection, then try again.",
		});
	}
}
