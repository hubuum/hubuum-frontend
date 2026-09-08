import { readFileSync } from "node:fs";

import { resolveApplicationVersion } from "../src/lib/build-version.ts";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

process.stdout.write(
	`${resolveApplicationVersion({
		packageVersion: packageJson.version,
		configuredVersion: process.env.NEXT_PUBLIC_APP_VERSION,
	})}\n`,
);
