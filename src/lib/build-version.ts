// Build-time only: this module must never be imported by application components.
import { execFileSync } from "node:child_process";

export function resolveApplicationVersion({
	cwd = process.cwd(),
	packageVersion,
	configuredVersion,
}: {
	cwd?: string;
	packageVersion: string;
	configuredVersion?: string;
}): string {
	if (configuredVersion?.trim()) {
		return configuredVersion.trim();
	}

	try {
		return execFileSync(
			"git",
			["describe", "--tags", "--match", "v[0-9]*", "--always", "--dirty"],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
	} catch {
		// Source archives and container contexts may have no Git metadata.
		return `v${packageVersion}+unknown`;
	}
}
