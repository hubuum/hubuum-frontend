import type { ReactNode } from "react";
import { z } from "zod";

const inventory = z.array(
	z.object({
		name: z.string(),
		kind: z.string().optional(),
		source: z.string(),
		enabled: z.boolean(),
		available: z.boolean(),
	}),
);

export function ProviderInventory({
	providers,
	action,
}: {
	providers: unknown;
	action?: (name: string) => ReactNode;
}) {
	const parsed = inventory.safeParse(providers);
	if (!parsed.success)
		return <p>Provider status is unavailable from this server.</p>;
	if (!parsed.data.length) return <p>No external providers are configured.</p>;
	return (
		<section
			className="table-wrap"
			aria-label="Current sign-in providers"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable tables need keyboard access.
			tabIndex={0}
		>
			<table>
				<caption>Current sign-in providers</caption>
				<thead>
					<tr>
						<th scope="col">Login scope</th>
						<th scope="col">Provider</th>
						<th scope="col">Managed by</th>
						<th scope="col">Sign-in</th>
						<th scope="col">Available on this server</th>
						{action && <th scope="col">Actions</th>}
					</tr>
				</thead>
				<tbody>
					{parsed.data.map((provider) => (
						<tr key={provider.name}>
							<th scope="row">{provider.name}</th>
							<td>
								{provider.kind?.toUpperCase() ??
									(provider.name === "local" ? "Local" : "LDAP")}
							</td>
							<td>
								{provider.source === "deployment"
									? "Deployment"
									: provider.source === "runtime"
										? "Runtime"
										: provider.source}
							</td>
							<td>{provider.enabled ? "Enabled" : "Disabled"}</td>
							<td>{provider.available ? "Yes" : "No"}</td>
							{action && <td>{action(provider.name)}</td>}
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
