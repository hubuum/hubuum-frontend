import { z } from "zod";
import type {
	ProviderCredentialInput,
	SecurityCandidateProviderRequest,
	SecurityCandidateRequest,
	SecurityConfigurationCapabilities,
} from "@/lib/api/generated/models";

const revision = z.number().int().positive().safe();
const duration = z.number().int().nonnegative().safe();
const text = z.string().min(1).max(4096);
const credential = z.discriminatedUnion("action", [
	z.object({ action: z.literal("keep") }).strict(),
	z.object({ action: z.literal("clear") }).strict(),
	z.object({ action: z.literal("reference"), alias: text }).strict(),
	z
		.object({
			action: z.literal("replace"),
			value: z.string().min(1).max(16384),
		})
		.strict(),
]);
const admission = z.discriminatedUnion("mode", [
	z.object({ mode: z.literal("existing_only") }).strict(),
	z.object({ mode: z.literal("provision_without_grants") }).strict(),
	z
		.object({
			mode: z.literal("subject_allowlist"),
			subjects: z.array(text).max(2048),
		})
		.strict(),
]);
const membership = z.discriminatedUnion("mode", [
	z
		.object({
			mode: z.literal("local_only"),
			refresh_interval_seconds: duration,
			max_stale_seconds: duration,
		})
		.strict(),
	z
		.object({
			mode: z.literal("provider_groups"),
			refresh_interval_seconds: duration,
			max_stale_seconds: duration,
			claim_pointer: text,
			claim_source: z.enum(["id_token", "userinfo", "profile"]),
			key_mode: z.enum(["full_path", "immutable_id"]),
		})
		.strict(),
]);
const common = {
	client_id: text,
	client_authentication: z.enum(["client_secret_basic", "client_secret_post"]),
	scopes: z.array(text).max(128),
	admission,
	membership,
	credential,
};
const oidc = z
	.object({
		...common,
		issuer: text,
		signing_algorithms: z
			.array(z.enum(["RS256", "ES256"]))
			.min(1)
			.max(2),
		retain_refresh_tokens: z.boolean().optional(),
	})
	.strict();
const oauth = z
	.object({
		...common,
		profile: z.enum(["github", "json_user"]),
		authorization_endpoint: text,
		token_endpoint: text,
		profile_endpoint: text,
		profile_headers: z.record(z.string(), z.string()).optional(),
		subject_pointer: text,
		subject_type: z.enum(["string", "integer"]),
		name_pointer: text,
	})
	.strict();
const providerBase = {
	name: z.string().min(1).max(160),
	enabled: z.boolean(),
	provider_id: z.uuid().nullable().optional(),
};
const provider = z.union([
	z
		.object({
			...providerBase,
			kind: z.enum(["ldap", "oidc", "oauth"]),
			source: z.literal("deployment"),
		})
		.strict(),
	z
		.object({
			...providerBase,
			kind: z.literal("ldap"),
			source: z.literal("runtime"),
			configuration: z.record(z.string(), z.unknown()),
			adopt_deployment: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			...providerBase,
			kind: z.literal("oidc"),
			source: z.literal("runtime"),
			configuration: oidc,
			adopt_deployment: z.boolean().optional(),
		})
		.strict(),
	z
		.object({
			...providerBase,
			kind: z.literal("oauth"),
			source: z.literal("runtime"),
			configuration: oauth,
			adopt_deployment: z.boolean().optional(),
		})
		.strict(),
]);

/** Wire shape only. DNS, TLS, admission, secrets and cross-field policy are
 * validated by the server's domain constructors and candidate checks. */
export const securityCandidateInput: z.ZodType<SecurityCandidateRequest> =
	z.discriminatedUnion("group", [
		z
			.object({
				group: z.literal("authentication"),
				expected_revision: revision,
				release_ownership: z.boolean().optional(),
				providers: z.array(provider).max(256).optional(),
			})
			.strict(),
		z
			.object({
				group: z.literal("authorization"),
				expected_revision: revision,
				release_ownership: z.boolean().optional(),
				backend: z.enum(["local", "treetop"]),
				source: z.enum(["runtime", "deployment"]),
				connection: z
					.object({
						url: text,
						trust_profile_id: text,
						connect_timeout_ms: duration,
						request_timeout_ms: duration,
					})
					.strict()
					.nullable()
					.optional(),
			})
			.strict(),
	]);

export const securityCapabilitiesSchema: z.ZodType<SecurityConfigurationCapabilities> =
	z.object({
		activatable_provider_kinds: z.array(text).max(256),
		configurable_provider_kinds: z.array(text).max(256),
		candidate_endpoint: text,
		candidate_lifetime_seconds: duration,
		deployment_locked_providers: z.array(text).max(256),
		ldap_verification_timeout_seconds: duration,
		private_targets_allowed: z.boolean(),
		replacement_credentials_available: z.boolean(),
		trust_profiles: z.array(text).max(256),
		treetop_connect_timeout_ceiling_ms: duration,
		treetop_request_timeout_ceiling_ms: duration,
	});

export const providerStatusesSchema = z
	.array(
		z.object({
			provider_id: z.uuid().nullable().optional(),
			name: z.string().min(1).max(160),
			kind: z.string().min(1).max(128),
			source: z.enum(["runtime", "deployment"]),
			enabled: z.boolean(),
			available: z.boolean(),
			definition_mutable: z.boolean(),
			credential_configured: z.boolean(),
			deployment_copy_definition: z.record(z.string(), z.unknown()).nullish(),
			runtime_definition: z
				.record(z.string(), z.unknown())
				.nullable()
				.optional(),
		}),
	)
	.max(256);
export type ProviderStatus = z.infer<typeof providerStatusesSchema>[number];
export type ExternalProviderKind = "ldap" | "oidc" | "oauth";
export type ProviderDraft = {
	key: string;
	providerId?: string | null;
	copiedFrom?: string;
	name: string;
	kind: ExternalProviderKind;
	source: "runtime" | "deployment";
	enabled: boolean;
	adoptDeployment: boolean;
	configurationText: string;
	credentialAction: ProviderCredentialInput["action"];
};
export function externalProviderKind(
	kind: string,
): ExternalProviderKind | null {
	return kind === "ldap" || kind === "oidc" || kind === "oauth" ? kind : null;
}

export function providerTemplate(
	kind: ExternalProviderKind,
	name: string,
): Record<string, unknown> {
	if (kind === "ldap")
		return {
			scope: name,
			url: "ldaps://directory.example.invalid:636",
			bind_dn: "",
			user_base_dn: "dc=example,dc=invalid",
			user_filter: "(uid={username})",
			subject_attribute: "entryUUID",
			group_attributes: ["memberOf"],
			group_rules: [],
		};
	const common = {
		client_id: "",
		client_authentication: "client_secret_basic",
		scopes: kind === "oidc" ? ["openid", "profile"] : [],
		admission: { mode: "existing_only" },
		membership: {
			mode: "local_only",
			refresh_interval_seconds: 300,
			max_stale_seconds: 900,
		},
	};
	if (kind === "oidc")
		return {
			...common,
			issuer: "https://identity.example.invalid/realm",
			signing_algorithms: ["RS256"],
			retain_refresh_tokens: false,
		};
	return {
		...common,
		profile: "github",
		client_authentication: "client_secret_post",
		authorization_endpoint: "https://github.com/login/oauth/authorize",
		token_endpoint: "https://github.com/login/oauth/access_token",
		profile_endpoint: "https://api.github.com/user",
		subject_pointer: "/id",
		subject_type: "integer",
		name_pointer: "/login",
	};
}

export function providerDraft(status: ProviderStatus): ProviderDraft | null {
	const kind = externalProviderKind(status.kind);
	if (!kind) return null;
	if (status.source === "runtime" && !status.runtime_definition)
		throw new Error(
			"The server did not return the runtime provider definition.",
		);
	return {
		key: status.provider_id ?? `deployment:${status.name}`,
		providerId: status.provider_id,
		name: status.name,
		kind,
		source: status.source,
		enabled: status.enabled,
		adoptDeployment: false,
		configurationText: JSON.stringify(
			parseProviderSettings(
				JSON.stringify(
					status.runtime_definition ?? providerTemplate(kind, status.name),
				),
			),
			null,
			2,
		),
		credentialAction: "keep",
	};
}

export function copyableDefinition(status: ProviderStatus) {
	return status.source === "runtime"
		? status.runtime_definition
		: status.deployment_copy_definition;
}

export function duplicateProvider(status: ProviderStatus): ProviderDraft {
	const kind = externalProviderKind(status.kind);
	const source = copyableDefinition(status);
	if (!kind || !source)
		throw new Error("This server did not supply copyable settings.");
	const settings = parseProviderSettings(JSON.stringify(source));
	if (kind === "ldap") delete settings.scope;
	return {
		key: crypto.randomUUID(),
		name: "",
		kind,
		source: "runtime",
		enabled: false,
		adoptDeployment: false,
		copiedFrom: status.name,
		configurationText: JSON.stringify(settings, null, 2),
		credentialAction:
			kind === "ldap" && !settings.bind_dn ? "clear" : "reference",
	};
}

export function providerChangeSummary(
	original: ProviderDraft[],
	drafts: ProviderDraft[],
): string[] {
	const saved = new Map(original.map((draft) => [draft.key, draft]));
	return drafts.map((draft) => {
		const previous = saved.get(draft.key);
		const activation = draft.enabled ? "enabled" : "disabled";
		if (!previous)
			return `Add ${draft.name} as ${activation}.${draft.copiedFrom ? ` Copied from ${draft.copiedFrom}.` : ""}`;
		const changes: string[] = [];
		if (draft.enabled !== previous.enabled)
			changes.push(draft.enabled ? "Enable sign-in" : "Disable sign-in");
		if (draft.source !== previous.source)
			changes.push(
				draft.source === "runtime"
					? "Adopt the deployment definition"
					: "Use the deployment definition",
			);
		if (
			draft.source === "runtime" &&
			draft.configurationText !== previous.configurationText
		)
			changes.push("Update provider settings");
		if (draft.source === "runtime" && draft.credentialAction !== "keep")
			changes.push(
				{
					clear: "Clear the credential",
					reference: "Use a deployment secret alias",
					replace: "Replace the credential",
				}[draft.credentialAction],
			);
		return changes.length
			? `${draft.name} · ${changes.join(". ")}.`
			: `${draft.name} stays ${activation}.`;
	});
}

export function providerRequest(
	draft: ProviderDraft,
	secret: ProviderCredentialInput,
): SecurityCandidateProviderRequest {
	const base = {
		provider_id: draft.providerId,
		name: draft.name,
		enabled: draft.enabled,
	};
	if (draft.source === "deployment")
		return { ...base, kind: draft.kind, source: "deployment" };
	const configuration = parseProviderSettings(draft.configurationText);
	if (draft.copiedFrom) {
		if (
			secret.action === "keep" ||
			(secret.action === "clear" &&
				(draft.kind !== "ldap" || configuration.bind_dn))
		) {
			throw new Error(
				"Supply a credential or deployment secret alias for the new provider.",
			);
		}
		if (draft.kind === "ldap") configuration.scope = draft.name;
	}
	if (draft.kind === "ldap") {
		if (configuration.scope !== draft.name)
			throw new Error("The LDAP scope must match the provider name.");
		switch (secret.action) {
			case "keep":
				break;
			case "clear":
				configuration.bind_password = null;
				configuration.bind_password_ref = null;
				break;
			case "reference":
				configuration.bind_password = null;
				configuration.bind_password_ref = secret.alias;
				break;
			case "replace":
				configuration.bind_password = secret.value;
				configuration.bind_password_ref = null;
				break;
		}
		return {
			...base,
			kind: "ldap",
			source: "runtime",
			adopt_deployment: draft.adoptDeployment,
			configuration,
		};
	}
	return {
		...base,
		kind: draft.kind,
		source: "runtime",
		adopt_deployment: draft.adoptDeployment,
		configuration:
			draft.kind === "oidc"
				? oidc.parse({ ...configuration, credential: secret })
				: oauth.parse({ ...configuration, credential: secret }),
	};
}

/** The advanced editor accepts non-secret protocol settings only. Credential
 * values and aliases use separate write-only inputs and are cleared on submit. */
export function parseProviderSettings(raw: string): Record<string, unknown> {
	if (raw.length > 128 * 1024)
		throw new Error("Provider settings are too large.");
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error("Provider settings require valid JSON.");
	}
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Provider settings require a JSON object.");
	const visit = (node: unknown, depth: number) => {
		if (depth > 16) throw new Error("Provider settings are nested too deeply.");
		if (!node || typeof node !== "object") return;
		for (const [key, child] of Object.entries(node)) {
			if (
				/password|secret|credential|token|alias|envelope|authorization|cookie|private_key/i.test(
					key,
				) &&
				key !== "authorization_endpoint" &&
				key !== "token_endpoint" &&
				key !== "retain_refresh_tokens"
			)
				throw new Error(
					"Enter credential values and aliases through the separate write-only controls.",
				);
			visit(child, depth + 1);
		}
	};
	visit(value, 0);
	return value as Record<string, unknown>;
}

export function securityCandidateError(status: number): string {
	if (status === 401 || status === 403)
		return "A local, unscoped human administrator is required. Sign in with a local recovery account, then recreate and test the candidate.";
	if ([409, 410, 412].includes(status))
		return "The candidate, credential or configuration changed or expired. Reload configuration, recreate the candidate and repeat its checks before activation.";
	if (status === 429)
		return "Verification is rate limited. Wait before trying again.";
	if (status === 400 || status === 422)
		return "The server rejected these settings or does not support this operation. Review provider configuration, deployment locks and advertised capabilities.";
	return "The server could not confirm the result. Inspect current configuration before retrying a change.";
}
