import Link from "next/link";
import { authenticationMessage } from "@/lib/browser-authentication";

export const metadata = { title: "Authentication request" };

export default async function AuthenticationComplete({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const error = typeof params.error === "string" ? params.error : null;
	return (
		<main className="auth-page">
			<section className="card stack">
				<h1>
					{error ? "Authentication stopped" : "Return to your original tab"}
				</h1>
				<p role={error ? "alert" : "status"}>
					{error
						? authenticationMessage(error)
						: "Your original tab shows the result of this request. You can close this tab."}
				</p>
				<Link href="/login">Return to sign-in</Link>
			</section>
		</main>
	);
}
