import { z } from "zod";
import { frontendApiPath, hubuumBffPath } from "@/lib/api/frontend";

const methodSchema = z
	.object({
		provider_id: z.union([z.literal("local"), z.uuid()]),
		name: z.string().min(1).max(160),
		kind: z.enum(["local", "ldap", "oidc", "oauth"]),
		interaction: z.enum(["credentials", "browser"]),
		fresh_authentication: z.boolean(),
		browser_available: z.boolean(),
	})
	.refine(
		(method) =>
			(method.provider_id === "local") === (method.kind === "local") &&
			["local", "ldap"].includes(method.kind) ===
				(method.interaction === "credentials"),
	);
export type BrowserAuthenticationMethod = z.infer<typeof methodSchema>;
const flowSchema = z
	.object({
		id: z.uuid(),
		nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
		purpose: z.enum(["login", "credential_approval", "provider_verification"]),
		expires_at: z.iso.datetime({ offset: true }),
		interval_seconds: z.number().int().min(1).max(60),
		next: z.object({
			kind: z.literal("browser"),
			verification_uri: z.url().refine((value) => {
				const url = new URL(value);
				return (
					!url.username &&
					!url.password &&
					!url.search &&
					!url.hash &&
					url.pathname === "/api/v1/auth/interactions/browser" &&
					(url.protocol === "https:" ||
						(url.protocol === "http:" &&
							["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
				);
			}),
			user_code: z
				.string()
				.min(1)
				.max(128)
				.regex(/^\P{Cc}+$/u),
		}),
	})
	.strict();
export type BrowserAuthenticationFlow = z.infer<typeof flowSchema>;

const messages: Record<string, string> = {
	access_denied:
		"Sign-in or account admission was denied. Contact your administrator if access is required.",
	interaction_cancelled:
		"Authentication was cancelled. Start again when ready.",
	interaction_expired: "Authentication expired. Start a new request.",
	interaction_consumed:
		"This result was already used. Check the affected operation before starting again.",
	interaction_failed: "Authentication stopped. Start a new request.",
	interaction_invalid:
		"This request belongs to another browser or is no longer valid. Start again in this tab.",
	configuration_changed:
		"Provider or server configuration changed. Reload and start again.",
	capability_unsupported:
		"This provider cannot approve this operation. Use a supported account; local administrators can use local recovery.",
	provider_unavailable:
		"The provider is unavailable. Retry later, or explicitly choose local recovery.",
	cleanup_unconfirmed:
		"Cancellation could not be confirmed. Ask a local recovery administrator to inspect the request before retrying.",
	operation_outcome_unknown:
		"The operation may have completed. Inspect the affected account, task or restore before retrying.",
	operation_failed:
		"The operation was rejected. Review its current state before requesting a new approval.",
};
export function authenticationMessage(value: unknown): string {
	const reason =
		value && typeof value === "object" && "reason" in value
			? value.reason
			: value;
	return typeof reason === "string" && Object.hasOwn(messages, reason)
		? messages[reason]
		: "Authentication could not be confirmed. Reload and start a new request.";
}

async function readPublicResponse(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new Error(authenticationMessage(null));
	}
}

/** Only an actual missing interaction contract permits legacy password UI. */
export async function discoverBrowserAuthentication(
	signal?: AbortSignal,
	fetcher = fetch,
): Promise<BrowserAuthenticationMethod[] | null> {
	const response = await fetcher(frontendApiPath("/auth/methods"), {
		cache: "no-store",
		credentials: "include",
		signal,
	});
	if (response.status === 404) return null;
	if (!response.ok)
		throw new Error(
			authenticationMessage(
				await readPublicResponse(response).catch(() => null),
			),
		);
	const parsed = z
		.object({
			interaction_version: z.literal(1),
			methods: z.array(methodSchema).max(256),
		})
		.safeParse(await readPublicResponse(response));
	if (
		!parsed.success ||
		new Set(parsed.data.methods.map((method) => method.provider_id)).size !==
			parsed.data.methods.length
	)
		throw new Error(authenticationMessage(null));
	return parsed.data.methods;
}

export function authenticationReason(value: unknown): string | null {
	return typeof value === "string" && Object.hasOwn(messages, value)
		? value
		: null;
}

export async function approvalAuthenticationMethod(
	signal?: AbortSignal,
): Promise<BrowserAuthenticationMethod | null> {
	const methods = await discoverBrowserAuthentication(signal);
	if (methods === null) return null;
	const response = await fetch(hubuumBffPath("/api/v1/iam/me"), {
		cache: "no-store",
		credentials: "include",
		signal,
	});
	const parsed = z
		.object({
			principal: z.object({
				identity_scope: z.string().min(1),
				kind: z.enum(["human", "service_account"]),
			}),
			token: z.object({ scope: z.unknown().nullish() }),
		})
		.safeParse(await readPublicResponse(response));
	if (!response.ok || !parsed.success)
		throw new Error(
			"Your current identity could not be verified. Sign in again.",
		);
	if (parsed.data.principal.kind !== "human" || parsed.data.token.scope != null)
		throw new Error(authenticationMessage("capability_unsupported"));
	const scope = parsed.data.principal.identity_scope;
	const method = methods.find((item) =>
		scope === "local"
			? item.kind === "local"
			: item.kind !== "local" && item.name === scope,
	);
	if (!method) throw new Error(authenticationMessage("provider_unavailable"));
	if (!method.fresh_authentication)
		throw new Error(authenticationMessage("capability_unsupported"));
	if (method.interaction === "browser" && !method.browser_available)
		throw new Error(authenticationMessage("provider_unavailable"));
	return method;
}

export async function beginBrowserAuthentication(
	input: Record<string, unknown>,
	signal?: AbortSignal,
	fetcher = fetch,
): Promise<BrowserAuthenticationFlow> {
	const response = await fetcher(frontendApiPath("/auth/interactions"), {
		method: "POST",
		credentials: "include",
		cache: "no-store",
		signal,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const payload: unknown = await readPublicResponse(response);
	if (!response.ok) throw new Error(authenticationMessage(payload));
	const parsed = flowSchema.safeParse(payload);
	if (
		!parsed.success ||
		parsed.data.purpose !== input.purpose ||
		Date.parse(parsed.data.expires_at) <= Date.now() ||
		Date.parse(parsed.data.expires_at) > Date.now() + 600_000
	)
		throw new Error(authenticationMessage(null));
	return parsed.data;
}

export async function cancelBrowserAuthentication(
	flow: BrowserAuthenticationFlow,
): Promise<void> {
	const response = await fetch(
		frontendApiPath(`/auth/interactions/${flow.id}/cancel`),
		{
			method: "POST",
			credentials: "include",
			cache: "no-store",
			keepalive: true,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nonce: flow.nonce }),
		},
	);
	if (!response.ok)
		throw new Error(
			authenticationMessage(
				await readPublicResponse(response).catch(() => null),
			),
		);
}

function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const done = () => {
			signal.removeEventListener("abort", abort);
			resolve();
		};
		const timer = setTimeout(done, milliseconds);
		const abort = () => {
			clearTimeout(timer);
			reject(signal.reason);
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}

/** Public metadata only; each poll is bound to its own nonce and server cookie. */
export async function waitForBrowserAuthentication(
	flow: BrowserAuthenticationFlow,
	signal: AbortSignal,
	fetcher = fetch,
): Promise<unknown> {
	let interval = flow.interval_seconds;
	const deadline = Date.parse(flow.expires_at);
	while (Date.now() < deadline) {
		await pause(Math.min(interval * 1000, deadline - Date.now()), signal);
		if (Date.now() >= deadline) break;
		const response = await fetcher(
			frontendApiPath(`/auth/interactions/${flow.id}/result`),
			{
				method: "POST",
				credentials: "include",
				cache: "no-store",
				signal,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nonce: flow.nonce }),
			},
		);
		const payload: unknown = await readPublicResponse(response);
		const progress = z
			.object({
				state: z.enum(["pending", "claimed"]),
				interval_seconds: z.number().int().min(1).max(601),
			})
			.safeParse(payload);
		const retry = Number(response.headers.get("retry-after"));
		if (response.ok && progress.success) {
			interval = Math.max(
				flow.interval_seconds,
				progress.data.interval_seconds,
				Number.isFinite(retry) ? Math.min(601, retry) : 0,
			);
			continue;
		}
		if (
			(response.status === 429 || response.status === 409) &&
			payload &&
			typeof payload === "object" &&
			"reason" in payload &&
			["interaction_pending", "slow_down"].includes(String(payload.reason))
		) {
			interval = Math.max(
				flow.interval_seconds,
				Number.isFinite(retry) ? Math.min(601, Math.max(1, retry)) : 5,
			);
			continue;
		}
		if (!response.ok) throw new Error(authenticationMessage(payload));
		const result = z
			.object({
				state: z.literal("finished"),
				purpose: z.literal(flow.purpose),
				result: z.unknown(),
			})
			.safeParse(payload);
		if (!result.success) throw new Error(authenticationMessage(null));
		return result.data.result;
	}
	throw new Error(authenticationMessage("interaction_expired"));
}
