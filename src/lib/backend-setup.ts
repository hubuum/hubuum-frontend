import { z } from "zod";

// Keep aligned with docs/compatibility.md and the bundled OpenAPI contract.
export const SUPPORTED_SERVER_VERSION = "0.0.22";

export function normalizeBackendOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error(
			"Enter a complete server URL, including http:// or https://.",
		);
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Use the server origin only, without credentials, /api paths, query parameters, or fragments.",
		);
	}
	return url.origin;
}

const operation = z.object({});
const installationSchema = z.object({
	openapi: z.string().startsWith("3."),
	info: z.object({
		title: z.literal("Hubuum REST API"),
		version: z.unknown().optional(),
	}),
	paths: z.record(z.string(), z.unknown()),
});

const sessionApiSchema = z.object({
	paths: z.object({
		"/api/v1/auth/login": z.object({ post: operation }),
		"/api/v1/auth/refresh": z.object({ post: operation }),
		"/api/v1/iam/me": z.object({ get: operation }),
	}),
});

export const backendAssessmentSchema = z.object({
	version: z.string().max(128).nullable(),
	compatibility: z.enum(["supported", "unverified", "incompatible"]),
	warnings: z.array(z.string().max(1024)).max(8),
});
export const backendCheckSchema = backendAssessmentSchema.extend({
	origin: z.string().url(),
});
export type BackendAssessment = z.infer<typeof backendAssessmentSchema>;
export type BackendCheck = z.infer<typeof backendCheckSchema>;

const clientConfigSchema = z.object({
	authentication: z.object({
		session_access_seconds: z.number().int().positive(),
		session_idle_seconds: z.number().int().positive(),
		session_absolute_seconds: z.number().int().positive(),
	}),
	pagination: z.object({
		default_page_limit: z.number().int().positive(),
		max_page_limit: z.number().int().positive(),
	}),
});

export function verifyBackendInstallation(
	document: unknown,
	config: unknown,
): BackendAssessment {
	const parsed = installationSchema.safeParse(document);
	if (!parsed.success) {
		throw new Error(
			"This URL does not expose a recognizable Hubuum API. Check the server address and proxy routing.",
		);
	}
	const rawVersion = parsed.data.info.version;
	const version =
		typeof rawVersion === "string" &&
		rawVersion.trim() &&
		rawVersion.length <= 128
			? rawVersion.trim()
			: null;
	const warnings: string[] = [];
	// Build metadata does not change a release. Other versions may work but have
	// not been verified against this frontend's declared compatibility target.
	const release = version?.match(
		/^v?(\d+\.\d+\.\d+)(?:\+[0-9A-Za-z.-]+)?$/,
	)?.[1];
	if (release !== SUPPORTED_SERVER_VERSION) {
		warnings.push(
			version
				? `Server ${version} has not been verified with this frontend. The tested release is v${SUPPORTED_SERVER_VERSION}.`
				: `The server did not report a recognizable version. The tested release is v${SUPPORTED_SERVER_VERSION}.`,
		);
	}
	const oldRelease = version?.match(/^v?0\.0\.(\d+)(?:$|[-+])/);
	const requiresBackport =
		oldRelease !== undefined &&
		oldRelease !== null &&
		Number(oldRelease[1]) < 20;
	const missingSessionApi = !sessionApiSchema.safeParse(document).success;
	if (requiresBackport) {
		warnings.push(
			"Standard releases before v0.0.20 lack the rotating-session authentication required by this frontend. Sign-in will fail unless that API has been backported.",
		);
	}
	if (missingSessionApi) {
		warnings.push(
			"The advertised API is missing required sign-in, refresh, or current-user operations. Sign-in and session renewal are expected to fail unless this is a patched server with an outdated API document.",
		);
	}
	if (!clientConfigSchema.safeParse(config).success) {
		warnings.push(
			"The server's public configuration is missing or could not be validated. Some features and displayed defaults may be unavailable.",
		);
	}
	return {
		version,
		compatibility:
			requiresBackport || missingSessionApi
				? "incompatible"
				: warnings.length
					? "unverified"
					: "supported",
		warnings,
	};
}
