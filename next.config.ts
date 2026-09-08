import type { NextConfig } from "next";

import packageJson from "./package.json";
import { resolveApplicationVersion } from "./src/lib/build-version";

const applicationVersion = resolveApplicationVersion({
	packageVersion: packageJson.version,
	configuredVersion: process.env.NEXT_PUBLIC_APP_VERSION,
});

const nextConfig: NextConfig = {
	allowedDevOrigins: ["127.0.0.1"],
	experimental: {
		// Next.js still needs the TypeScript 6 API; package scripts use native tsc 7.
		useTypeScriptCli: false,
	},
	output: "standalone",
	outputFileTracingExcludes: {
		"/login-backgrounds/custom/*": ["./login-backgrounds/**/*"],
	},
	poweredByHeader: false,
	env: {
		NEXT_PUBLIC_APP_VERSION: applicationVersion,
	},
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: [
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
				],
			},
		];
	},
};

export default nextConfig;
