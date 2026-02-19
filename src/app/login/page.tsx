import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getSessionFromServerCookies } from "@/lib/auth/session";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  if ("username" in params || "password" in params) {
    redirect("/login");
  }

  const session = await getSessionFromServerCookies();

  if (session) {
    redirect("/app");
  }

  return (
    <main className="auth-page">
      <div className="gradient-orb" />
      <LoginForm />
      <p className="muted footer-note">{process.env.NEXT_PUBLIC_APP_NAME ?? "Hubuum Console"}</p>
    </main>
  );
}
