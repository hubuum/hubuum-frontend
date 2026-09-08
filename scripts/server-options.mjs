import { isIP } from "node:net";
import { parseArgs } from "node:util";

export function parseServerOptions(
	args,
	env = process.env,
	{ development = false } = {},
) {
	const { tokens, values } = parseArgs({
		args,
		options: {
			port: { type: "string", short: "p" },
			listen: { type: "string" },
			hostname: { type: "string", short: "H" },
			help: { type: "boolean", short: "h" },
		},
		strict: !development,
		allowPositionals: development,
		tokens: true,
	});
	if (values.help) {
		return { help: true };
	}

	let port = env.PORT?.trim() || undefined;
	// Shells often export the machine's HOSTNAME. Local commands bind only to
	// IPv4 loopback unless the user explicitly chooses a listen address.
	let listen = "127.0.0.1";
	const consumed = new Set();
	for (const token of tokens) {
		if (
			token.kind !== "option" ||
			!["port", "listen", "hostname"].includes(token.name)
		) {
			continue;
		}
		if (
			typeof token.value !== "string" ||
			!token.value ||
			token.value.startsWith("-")
		) {
			throw new Error(`${token.rawName} requires a value.`);
		}
		consumed.add(token.index);
		if (!token.inlineValue) consumed.add(token.index + 1);
		if (token.name === "port") port = token.value;
		else listen = token.value;
	}

	if (
		port !== undefined &&
		(!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
	) {
		throw new Error("Port must be a whole number between 1 and 65535.");
	}
	if (listen === "*") listen = "0.0.0.0";
	if (
		listen.startsWith("[") &&
		listen.endsWith("]") &&
		isIP(listen.slice(1, -1)) === 6
	) {
		listen = listen.slice(1, -1);
	}
	if (/[\s/\\?#@[\]]/.test(listen) || (listen.includes(":") && !isIP(listen))) {
		throw new Error(
			"Listen address must be a hostname, an IP address, or * (without a port).",
		);
	}

	return {
		help: false,
		port: port === undefined ? "3000" : String(Number(port)),
		portSpecified: port !== undefined,
		listen,
		remainingArgs: args.filter((_, index) => !consumed.has(index)),
	};
}

export function printServerHelp(command) {
	console.info(`Usage: ${command} -- [options]

  --port, -p <port>       Port from 1 to 65535 (default: PORT or 3000)
  --listen <address>     Hostname or IP address (default: 127.0.0.1)
                        Use '*' for all IPv4 interfaces, or :: for IPv6.
  --hostname, -H <host>  Alias for --listen
  --help, -h             Show this help

Quote '*' to prevent shell expansion. Flags override environment settings.`);
}
