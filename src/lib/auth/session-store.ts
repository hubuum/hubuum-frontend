import "server-only";

import { getServerEnv } from "@/lib/env";
import { getValkeyClient } from "@/lib/valkey";

export type SessionPayload = {
  token: string;
  username?: string;
  createdAt: number;
  lastSeen: number;
};

interface SessionStore {
  create(sid: string, payload: SessionPayload): Promise<void>;
  get(sid: string): Promise<SessionPayload | null>;
  touch(sid: string, payload: SessionPayload): Promise<void>;
  destroy(sid: string): Promise<void>;
}

class InMemorySessionStore implements SessionStore {
  private readonly map = new Map<string, SessionPayload & { expiresAt: number }>();

  constructor(private readonly ttlSeconds: number) {}

  async create(sid: string, payload: SessionPayload): Promise<void> {
    this.map.set(sid, { ...payload, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async get(sid: string): Promise<SessionPayload | null> {
    const existing = this.map.get(sid);
    if (!existing) {
      return null;
    }

    if (existing.expiresAt < Date.now()) {
      this.map.delete(sid);
      return null;
    }

    return {
      token: existing.token,
      username: existing.username,
      createdAt: existing.createdAt,
      lastSeen: existing.lastSeen
    };
  }

  async touch(sid: string, payload: SessionPayload): Promise<void> {
    this.map.set(sid, { ...payload, expiresAt: Date.now() + this.ttlSeconds * 1000 });
  }

  async destroy(sid: string): Promise<void> {
    this.map.delete(sid);
  }
}

class ValkeySessionStore implements SessionStore {
  constructor(
    private readonly ttlSeconds: number,
    private readonly prefix: string
  ) {}

  private key(sid: string): string {
    return `${this.prefix}${sid}`;
  }

  async create(sid: string, payload: SessionPayload): Promise<void> {
    const client = getValkeyClient();
    if (!client) {
      throw new Error("Valkey is not configured.");
    }

    await client.set(this.key(sid), JSON.stringify(payload), "EX", this.ttlSeconds);
  }

  async get(sid: string): Promise<SessionPayload | null> {
    const client = getValkeyClient();
    if (!client) {
      throw new Error("Valkey is not configured.");
    }

    const raw = await client.get(this.key(sid));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      return null;
    }
  }

  async touch(sid: string, payload: SessionPayload): Promise<void> {
    const client = getValkeyClient();
    if (!client) {
      throw new Error("Valkey is not configured.");
    }

    await client.set(this.key(sid), JSON.stringify(payload), "EX", this.ttlSeconds);
  }

  async destroy(sid: string): Promise<void> {
    const client = getValkeyClient();
    if (!client) {
      throw new Error("Valkey is not configured.");
    }

    await client.del(this.key(sid));
  }
}

let store: SessionStore | null = null;
let warnedNoValkey = false;

export function getSessionStore(): SessionStore {
  if (store) {
    return store;
  }

  const env = getServerEnv();

  if (env.VALKEY_URL) {
    store = new ValkeySessionStore(env.SESSION_TTL_SECONDS, env.SESSION_PREFIX);
    return store;
  }

  if (env.NODE_ENV === "production" && !warnedNoValkey) {
    warnedNoValkey = true;
    console.warn(
      "VALKEY_URL is not set. Falling back to in-memory sessions, which are not shared across pods."
    );
  }

  store = new InMemorySessionStore(env.SESSION_TTL_SECONDS);
  return store;
}
