import Link from "next/link";

export default function AdminLandingPage() {
	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Admin</p>
				<h2>Identity & Access</h2>
			</header>

			<div className="grid cols-2">
				<article className="card stack">
					<h3>Users</h3>
					<p className="muted">
						Browse user accounts, check memberships, and inspect issued tokens.
					</p>
					<Link className="link-chip" href="/admin/users">
						Open users
					</Link>
				</article>

				<article className="card stack">
					<h3>Groups</h3>
					<p className="muted">
						Review groups, manage memberships, and track authorization
						boundaries.
					</p>
					<Link className="link-chip" href="/admin/groups">
						Open groups
					</Link>
				</article>

				<article className="card stack">
					<h3>Service accounts</h3>
					<p className="muted">
						Manage non-human principals for automation and scoped token access.
					</p>
					<Link className="link-chip" href="/admin/service-accounts">
						Open service accounts
					</Link>
				</article>

				<article className="card stack">
					<h3>Remote targets</h3>
					<p className="muted">
						Define outbound actions users can invoke from collections, classes,
						and objects.
					</p>
					<Link className="link-chip" href="/admin/remote-targets">
						Open remote targets
					</Link>
				</article>

				<article className="card stack">
					<h3>Events</h3>
					<p className="muted">
						Inspect event delivery health, failed deliveries, and retry actions.
					</p>
					<Link className="link-chip" href="/admin/events">
						Open events
					</Link>
				</article>
			</div>
		</section>
	);
}
