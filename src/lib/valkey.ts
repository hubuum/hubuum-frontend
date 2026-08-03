import "server-only";

import Redis from "ioredis";

import { getServerEnv } from "@/lib/env";
import {
	emitOperationalEvent,
	operationalErrorFields,
} from "@/lib/operational-events";

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

		client.on("ready", () => {
			emitOperationalEvent("info", "valkey.connection.ready");
		});
		client.on("reconnecting", (delay: number) => {
			emitOperationalEvent("warn", "valkey.connection.reconnecting", {
				delay_ms: delay,
			});
		});
		client.on("close", () => {
			emitOperationalEvent("warn", "valkey.connection.closed");
		});
		client.on("end", () => {
			emitOperationalEvent("error", "valkey.connection.ended");
		});
		client.on("error", (error) => {
			emitOperationalEvent("error", "valkey.connection.error", {
				...operationalErrorFields(error),
			});
		});
	}

	return client;
}

export async function pingValkey(): Promise<void> {
	const startedAt = Date.now();
	try {
		const response = await getValkeyClient().ping();
		if (response !== "PONG") {
			throw new Error("Valkey readiness check returned an unexpected response.");
		}
	} catch (error) {
		emitOperationalEvent("error", "valkey.ping.failed", {
			duration_ms: Date.now() - startedAt,
			...operationalErrorFields(error),
		});
		throw error;
	}
}
