import "server-only";

import Redis from "ioredis";

import { getServerEnv } from "@/lib/env";

let client: Redis | null = null;

export function getValkeyClient(): Redis | null {
  const env = getServerEnv();

  if (!env.VALKEY_URL) {
    return null;
  }

  if (!client) {
    client = new Redis(env.VALKEY_URL, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true
    });

    client.on("error", (error) => {
      console.error("Valkey connection error", error);
    });
  }

  return client;
}
