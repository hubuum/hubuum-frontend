import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { parseServerOptions, printServerHelp } from "./server-options.mjs";

let options;
try {
	options = parseServerOptions(process.argv.slice(2), process.env, {
		development: true,
	});
} catch (error) {
	console.error(`[startup] ${error.message}`);
	process.exit(1);
}

if (options.help) {
	printServerHelp("npm run dev");
	console.info(
		"\nOther Next.js development options are forwarded. See: npx next dev --help",
	);
	process.exit(0);
}

if (!options.portSpecified) delete process.env.PORT;

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
process.argv = [
	process.execPath,
	nextCli,
	"dev",
	"--hostname",
	options.listen,
	...(options.portSpecified ? ["--port", options.port] : []),
	...options.remainingArgs,
];
await import(pathToFileURL(nextCli).href);
