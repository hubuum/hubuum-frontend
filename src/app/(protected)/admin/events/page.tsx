import { AdminEventsWorkspace } from "@/components/admin-events-workspace";

export default function AdminEventsPage() {
	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<h2>Events</h2>
				</div>
				<p className="muted">
					Inspect event delivery health, configured sinks, and delivery retry
					state.
				</p>
			</header>
			<AdminEventsWorkspace />
		</section>
	);
}
