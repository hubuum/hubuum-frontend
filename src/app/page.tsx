import { redirect } from "next/navigation";

import { getSessionFromServerCookies } from "@/lib/auth/session";
import { getBackendSetupStatus } from "@/lib/backend-target";

export default async function RootPage() {
	if (await getBackendSetupStatus() !== "configured") redirect("/setup");
	const session = await getSessionFromServerCookies();

	redirect(session ? "/app" : "/login");
}
