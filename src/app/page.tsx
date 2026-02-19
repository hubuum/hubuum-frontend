import { redirect } from "next/navigation";

import { getSessionFromServerCookies } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await getSessionFromServerCookies();

  redirect(session ? "/app" : "/login");
}
