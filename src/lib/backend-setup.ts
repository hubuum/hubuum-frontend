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
		version: z.string().min(1).max(128),
	}),
	paths: z.object({
		"/api/v1/auth/login": z.object({ post: operation }),
		"/api/v1/auth/refresh": z.object({ post: operation }),
		"/api/v1/iam/me": z.object({ get: operation }),
		"/api/v1/config": z.object({ get: operation }),
	}),
});

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
): string {
	const parsed = installationSchema.safeParse(document);
	if (!parsed.success) {
		throw new Error(
			"This URL does not expose a supported Hubuum API. Check the server address and proxy routing.",
		);
	}
	const version = parsed.data.info.version;
	// Build metadata does not change a release. Prereleases and later builds are
	// not declared supported merely because their version sorts after our target.
	const release = version.match(
		/^v?(\d+\.\d+\.\d+)(?:\+[0-9A-Za-z.-]+)?$/,
	)?.[1];
	if (release !== SUPPORTED_SERVER_VERSION) {
		throw new Error(
			`Server version ${version} is not supported by this frontend. Use Hubuum Server v${SUPPORTED_SERVER_VERSION} or a matching frontend release.`,
		);
	}
	if (!clientConfigSchema.safeParse(config).success) {
		throw new Error(
			"The server's public configuration is missing or incompatible with this frontend.",
		);
	}
	return version;
}
