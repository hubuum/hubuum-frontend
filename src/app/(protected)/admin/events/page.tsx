import { AdminEventsWorkspace } from "@/components/admin-events-workspace";

export default function AdminEventsPage() {
	return (
		<section className="stack">
			<header>
				<p className="eyebrow">Admin</p>
				<h2>Events</h2>
				<p className="muted">
					Inspect event delivery health, configured sinks, and delivery retry
					state.
				</p>
			</header>
			<AdminEventsWorkspace />
		</section>
	);
}
