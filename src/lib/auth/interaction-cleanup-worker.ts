import "server-only";

import { setInterval } from "node:timers";
import { emitOperationalEvent } from "@/lib/operational-events";
import { recoverAbandonedInteractions } from "./pending-interactions";

const worker = globalThis as typeof globalThis & {
	hubuumAuthenticationCleanup?: ReturnType<typeof setInterval>;
};

export function startAuthenticationCleanup(): void {
	if (worker.hubuumAuthenticationCleanup) return;
	let running = false;
	const tick = async () => {
		if (running) return;
		running = true;
		try {
			const result = await recoverAbandonedInteractions();
			if (result.attempted)
				emitOperationalEvent(
					result.unconfirmed ? "warn" : "info",
					"authentication.cleanup.completed",
					result,
				);
		} catch {
			emitOperationalEvent("warn", "authentication.cleanup.unavailable");
		} finally {
			running = false;
		}
	};
	worker.hubuumAuthenticationCleanup = setInterval(() => {
		void tick();
	}, 30_000);
	worker.hubuumAuthenticationCleanup.unref();
	void tick();
}
