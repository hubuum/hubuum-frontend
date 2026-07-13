export type DependencyStatus = "error" | "ok";

export type ReadinessResult = {
	ready: boolean;
	dependencies: {
		backend: DependencyStatus;
		valkey: DependencyStatus;
	};
};

type ReadinessOptions = {
	backendBaseUrl: string;
	pingValkey: () => Promise<void>;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
};

export async function checkReadiness({
	backendBaseUrl,
	pingValkey,
	fetchImpl = fetch,
	timeoutMs = 2_000,
}: ReadinessOptions): Promise<ReadinessResult> {
	const backendCheck = fetchImpl(new URL("/readyz", backendBaseUrl), {
		cache: "no-store",
		headers: { Accept: "application/json" },
		method: "GET",
		signal: AbortSignal.timeout(timeoutMs),
	})
		.then((response) => (response.ok ? "ok" : "error") as DependencyStatus)
		.catch(() => "error" as const);

	const valkeyCheck = pingValkey()
		.then(() => "ok" as const)
		.catch(() => "error" as const);

	const [backend, valkey] = await Promise.all([backendCheck, valkeyCheck]);
	return {
		ready: backend === "ok" && valkey !== "error",
		dependencies: { backend, valkey },
	};
}
