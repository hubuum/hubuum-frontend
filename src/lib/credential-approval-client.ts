import { frontendApiPath, HUBUUM_BFF_PREFIX } from "@/lib/api/frontend";
import { CORRELATION_ID_HEADER } from "@/lib/correlation";
import {
	beginBrowserAuthentication,
	type BrowserAuthenticationFlow,
} from "@/lib/browser-authentication";
import {
	credentialOperation,
	credentialOperationSummary,
	isCredentialMutationPath,
	isRecord,
} from "@/lib/credential-operation";

export type CredentialConfirmation = {
	summary: string;
	signal: AbortSignal;
	submit: (password: string) => Promise<Response>;
	begin: (providerId: string) => Promise<BrowserAuthenticationFlow>;
};
type ConfirmationHandler = (
	confirmation: CredentialConfirmation,
) => Promise<Response | null>;
let confirmationHandler: ConfirmationHandler | null = null;

export function registerCredentialConfirmation(
	handler: ConfirmationHandler,
): () => void {
	confirmationHandler = handler;
	return () => {
		if (confirmationHandler === handler) confirmationHandler = null;
	};
}

/** Only a stable backend rejection opts an existing mutation into fresh auth. */
export async function fetchWithCredentialApproval(
	fetcher: typeof fetch,
	url: URL,
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const method = (
		init?.method ?? (input instanceof Request ? input.method : "GET")
	).toUpperCase();
	const path = url.pathname.slice(HUBUUM_BFF_PREFIX.length);
	const eligible =
		isCredentialMutationPath(method, path) &&
		url.pathname.startsWith(`${HUBUUM_BFF_PREFIX}/`) &&
		!url.search;
	// Clone before fetch consumes a Request body. Never retain unrelated requests.
	const snapshot = eligible
		? new Request(input instanceof Request ? input.clone() : url, init)
		: null;
	try {
		const response = await fetcher(input, init);
		if (!snapshot || response.status !== 403 || !confirmationHandler)
			return response;
		const error: unknown = await response
			.clone()
			.json()
			.catch(() => null);
		if (!isRecord(error) || error.reason !== "reauthentication_required")
			return response;
		const body: unknown = await snapshot.json().catch(() => null);
		const operation = credentialOperation(method, path, body);
		if (!operation || snapshot.signal.aborted) return response;
		const headers = new Headers({ "Content-Type": "application/json" });
		const correlationId = snapshot.headers.get(CORRELATION_ID_HEADER);
		if (correlationId) headers.set(CORRELATION_ID_HEADER, correlationId);
		let transport: "password" | "browser" | null = null;
		const result = await confirmationHandler({
			summary: credentialOperationSummary(operation),
			signal: snapshot.signal,
			begin: (providerId) => {
				if (transport)
					throw new Error(
						"This prepared approval was already started. Inspect its outcome before retrying.",
					);
				transport = "browser";
				return beginBrowserAuthentication(
					{
						provider_id: providerId,
						purpose: "credential_approval",
						return_path: "/authentication/complete",
						mutation: {
							method,
							path,
							body,
							ifMatch: snapshot.headers.get("if-match") ?? undefined,
							idempotencyKey:
								snapshot.headers.get("idempotency-key") ?? undefined,
						},
					},
					snapshot.signal,
					fetcher,
				);
			},
			submit: (password) => {
				if (transport === "browser")
					throw new Error("Browser approval cannot fall back to a password.");
				transport = "password";
				return fetcher(frontendApiPath("/credential-mutations"), {
					method: "POST",
					credentials: "include",
					cache: "no-store",
					headers,
					signal: snapshot.signal,
					body: JSON.stringify({
						password,
						method,
						path,
						body,
						ifMatch: snapshot.headers.get("if-match"),
						idempotencyKey: snapshot.headers.get("idempotency-key"),
					}),
				});
			},
		});
		return (
			result ??
			Response.json(
				{ message: "Credential operation cancelled." },
				{ status: 409 },
			)
		);
	} finally {
		if (snapshot?.body && !snapshot.bodyUsed)
			void snapshot.body.cancel().catch(() => {});
	}
}
