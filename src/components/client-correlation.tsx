"use client";

import { useEffect } from "react";

import {
	CORRELATION_ID_HEADER,
	generateCorrelationId,
	normalizeCorrelationId,
} from "@/lib/correlation";
import {
	buildSessionExpiryLoginPath,
	isSessionExpiryResponse,
} from "@/lib/client-session-expiry";
import { clearUserSettingsForLogout } from "@/lib/user-settings-client";

const INTERACTION_TTL_MS = 30_000;

type ActiveInteraction = {
	correlationId: string;
	expiresAt: number;
};

let activeInteraction: ActiveInteraction | null = null;
let clearInteractionTimer: number | null = null;
let fetchPatched = false;
let sessionExpiryRedirectStarted = false;

function clearActiveInteraction() {
	activeInteraction = null;
	if (clearInteractionTimer !== null) {
		window.clearTimeout(clearInteractionTimer);
		clearInteractionTimer = null;
	}
}

function scheduleInteractionExpiry(correlationId: string) {
	if (clearInteractionTimer !== null) {
		window.clearTimeout(clearInteractionTimer);
	}

	clearInteractionTimer = window.setTimeout(() => {
		if (activeInteraction?.correlationId === correlationId) {
			activeInteraction = null;
		}
		clearInteractionTimer = null;
	}, INTERACTION_TTL_MS);
}

function beginInteraction() {
	const correlationId = generateCorrelationId();
	activeInteraction = {
		correlationId,
		expiresAt: Date.now() + INTERACTION_TTL_MS,
	};
	scheduleInteractionExpiry(correlationId);
}

function getActiveInteractionCorrelationId(): string | null {
	if (!activeInteraction) {
		return null;
	}

	if (Date.now() >= activeInteraction.expiresAt) {
		clearActiveInteraction();
		return null;
	}

	return activeInteraction.correlationId;
}

function getSameOriginRequestUrl(input: RequestInfo | URL): URL | null {
	if (input instanceof Request) {
		try {
			const target = new URL(input.url, window.location.href);
			return target.origin === window.location.origin ? target : null;
		} catch {
			return null;
		}
	}

	if (input instanceof URL) {
		return input.origin === window.location.origin ? input : null;
	}

	if (typeof input === "string") {
		try {
			const target = new URL(input, window.location.href);
			return target.origin === window.location.origin ? target : null;
		} catch {
			return null;
		}
	}

	return null;
}

function redirectAfterSessionExpiry() {
	if (sessionExpiryRedirectStarted || window.location.pathname === "/login") {
		return;
	}

	sessionExpiryRedirectStarted = true;
	const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
	const loginPath = buildSessionExpiryLoginPath(currentPath);

	try {
		clearUserSettingsForLogout();
	} finally {
		window.location.replace(loginPath);
	}
}

function installClientFetchPatch() {
	if (fetchPatched) {
		return;
	}

	const originalFetch = window.fetch.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const requestUrl = getSameOriginRequestUrl(input);
		if (!requestUrl) {
			return originalFetch(input, init);
		}

		const interactionCorrelationId = getActiveInteractionCorrelationId();
		let requestInit = init;
		if (interactionCorrelationId) {
			const headers = new Headers(init?.headers);
			const existingHeader = normalizeCorrelationId(
				headers.get(CORRELATION_ID_HEADER),
			);
			if (!existingHeader) {
				headers.set(CORRELATION_ID_HEADER, interactionCorrelationId);
			}

			requestInit = {
				...init,
				headers,
			};
		}

		const response = await originalFetch(input, requestInit);
		if (isSessionExpiryResponse(requestUrl, response.status)) {
			redirectAfterSessionExpiry();
		}
		return response;
	}) as typeof window.fetch;

	fetchPatched = true;
}

export function ClientCorrelation() {
	useEffect(() => {
		installClientFetchPatch();

		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 0) {
				return;
			}

			beginInteraction();
		};

		const onSubmit = () => {
			beginInteraction();
		};

		document.addEventListener("pointerdown", onPointerDown, {
			capture: true,
			passive: true,
		});
		document.addEventListener("submit", onSubmit, true);

		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("submit", onSubmit, true);
		};
	}, []);

	return null;
}
