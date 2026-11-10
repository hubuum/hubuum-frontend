"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { BackendSetupForm } from "@/components/backend-setup-form";
import { getApiErrorMessage } from "@/lib/api/errors";
import { frontendApiPath } from "@/lib/api/frontend";

const connectionSchema = z.object({
	origin: z.string().url(),
	revision: z.string(),
	managed: z.boolean(),
});

export function BackendConnectionPanel() {
	const connection = useQuery({
		queryKey: ["backend-connection"],
		queryFn: async () => {
			const response = await fetch(frontendApiPath("/connection"), {
				credentials: "include",
			});
			const data: unknown = await response.json();
			if (!response.ok)
				throw new Error(
					getApiErrorMessage(data, "Could not load the server connection."),
				);
			return connectionSchema.parse(data);
		},
		retry: false,
	});
	return (
		<section
			className="stack backend-connection-panel"
			aria-label="Frontend server connection"
		>
			<header className="stack action-card-header">
				<h3>Server connection</h3>
				<p className="muted">
					The Hubuum Server used by this frontend installation.
				</p>
			</header>
			{connection.isPending ? <p role="status">Loading connection…</p> : null}
			{connection.error ? (
				<p role="alert" className="error-banner">
					{connection.error.message}
				</p>
			) : null}
			{connection.data ? (
				<>
					<p>
						Current server: <strong>{connection.data.origin}</strong>
					</p>
					{connection.data.managed ? (
						<p className="muted">
							This connection is managed by <code>BACKEND_BASE_URL</code>.
							Change the deployment configuration and restart the frontend to
							select another server.
						</p>
					) : (
						<BackendSetupForm
							key={connection.data.revision}
							expectedRevision={connection.data.revision}
						/>
					)}
				</>
			) : null}
		</section>
	);
}
