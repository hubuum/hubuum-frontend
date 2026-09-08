import type { Metadata } from "next";
import { headers } from "next/headers";

import { APPLICATION_VERSION } from "@/lib/application-version";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";
import { fetchServerVersion } from "@/lib/server-version";

export const metadata: Metadata = { title: "About" };

export default async function AboutPage() {
	await requireServerSession();
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const serverVersion = await fetchServerVersion(correlationId);

	return (
		<section className="stack">
			<header>
				<h2>About Hubuum</h2>
				<p className="muted">
					Version information for this console and its connected server.
				</p>
			</header>

			<div className="grid cols-2">
				<article
					className="card stack panel-card"
					aria-labelledby="frontend-heading"
				>
					<h3 id="frontend-heading">Hubuum Frontend</h3>
					<dl className="event-detail-grid">
						<div>
							<dt>Version</dt>
							<dd>
								<code>{APPLICATION_VERSION}</code>
							</dd>
						</div>
					</dl>
					<p className="muted">The browser console you are using.</p>
				</article>
				<article
					className="card stack panel-card"
					aria-labelledby="server-heading"
				>
					<h3 id="server-heading">Hubuum Server</h3>
					<dl className="event-detail-grid">
						<div>
							<dt>Version</dt>
							<dd>
								{serverVersion ? <code>{serverVersion}</code> : "Unavailable"}
							</dd>
						</div>
					</dl>
					<p className="muted">
						{serverVersion
							? "The version reported by the connected server. Older servers may report only their release number."
							: "The server could not provide version information. It may be temporarily unreachable or have version discovery disabled."}
					</p>
				</article>
			</div>

			<article className="card stack panel-card">
				<h3>Reading the frontend version</h3>
				<p>
					A release shows its tag, such as <code>v0.0.13</code>. A build after
					that release shows the number of commits since the tag and the current
					commit: <code>v0.0.13-16-g256d59b</code> means 16 commits after
					v0.0.13.
				</p>
				<p className="muted">
					The <code>-dirty</code> suffix marks uncommitted changes to tracked
					files. Without a reachable release tag, the version is the commit ID.{" "}
					<code>+unknown</code> means Git build information was unavailable.
				</p>
			</article>
		</section>
	);
}
