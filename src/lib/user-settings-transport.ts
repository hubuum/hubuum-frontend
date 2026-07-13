"use client";

import {
	normalizeUserSettingsSnapshot,
	type UserSettingsSnapshot,
} from "@/lib/user-settings-types";

export class UserSettingsTransportError extends Error {
	constructor(
		message: string,
		readonly status: number | null,
	) {
		super(message);
		this.name = "UserSettingsTransportError";
	}
}

async function readErrorMessage(
	response: Response,
	fallback: string,
): Promise<string> {
	const payload = (await response.json().catch(() => null)) as {
		message?: unknown;
	} | null;
	return typeof payload?.message === "string" ? payload.message : fallback;
}

export async function loadUserSettingsSnapshot(): Promise<UserSettingsSnapshot> {
	const response = await fetch("/_hubuum-bff/settings", {
		credentials: "include",
		cache: "no-store",
	});
	if (!response.ok) {
		throw new UserSettingsTransportError(
			await readErrorMessage(response, "Could not load user settings."),
			response.status,
		);
	}

	const snapshot = normalizeUserSettingsSnapshot(
		await response.json().catch(() => null),
	);
	if (!snapshot) {
		throw new UserSettingsTransportError(
			"The server returned an invalid user settings snapshot.",
			response.status,
		);
	}
	return snapshot;
}

export async function patchUserSettings(
	updates: Record<string, string | null>,
	options: { keepalive?: boolean } = {},
): Promise<void> {
	let response: Response;
	try {
		response = await fetch("/_hubuum-bff/settings", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ updates }),
			keepalive: options.keepalive,
		});
	} catch (error) {
		throw new UserSettingsTransportError(
			error instanceof Error ? error.message : "Settings update failed.",
			null,
		);
	}

	if (!response.ok) {
		throw new UserSettingsTransportError(
			await readErrorMessage(response, "Settings update failed."),
			response.status,
		);
	}
}

export function isRetryableSettingsError(error: unknown): boolean {
	if (!(error instanceof UserSettingsTransportError)) return true;
	if (error.status === null) return true;
	return error.status === 408 || error.status === 429 || error.status >= 500;
}
