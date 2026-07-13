import "server-only";

import Redis from "ioredis";

import { getServerEnv } from "@/lib/env";

let client: Redis | null = null;

export function getValkeyClient(): Redis {
	const env = getServerEnv();

	if (!client) {
		client = new Redis(env.VALKEY_URL, {
			commandTimeout: 2_000,
			connectTimeout: 2_000,
			maxRetriesPerRequest: 2,
			enableReadyCheck: true,
			lazyConnect: true,
		});

		client.on("error", (error) => {
			console.error("Valkey connection error", error);
		});
	}

	return client;
}

export async function pingValkey(): Promise<void> {
	const response = await getValkeyClient().ping();
	if (response !== "PONG") {
		throw new Error("Valkey readiness check returned an unexpected response.");
	}
}
