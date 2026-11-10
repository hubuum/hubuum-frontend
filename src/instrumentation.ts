export async function register() {
	if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.VALKEY_URL) return;
	const { initializeSetupKey } = await import("@/lib/backend-target");
	try {
		await initializeSetupKey(true);
	} catch {
		console.error(
			"[hubuum-setup] Setup initialization is unavailable; check the frontend configuration and Valkey connection.",
		);
	}
}
