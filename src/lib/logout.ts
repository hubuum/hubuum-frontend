import { frontendApiPath } from "@/lib/api/frontend";

export async function endBrowserSession(
	flushSettings: () => Promise<unknown>,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve()
				.then(flushSettings)
				.catch(() => undefined),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, 750);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
	const response = await fetch(frontendApiPath("/auth/logout"), {
		method: "POST",
		credentials: "include",
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok)
		throw new Error("Sign-out could not be completed. Please try again.");
}
