import type { ReactNode } from "react";

import type { RunningConfig } from "@/lib/api/generated/models";
import { formatScopedIdentityName } from "@/lib/identity-scopes";

type RuntimeStat = {
	label: string;
	value: ReactNode;
};

const numberFormatter = new Intl.NumberFormat(undefined, {
	maximumFractionDigits: 1,
});

function formatNumber(value: number): string {
	return numberFormatter.format(value);
}

function formatBytes(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "n/a";
	if (value < 1024) return `${formatNumber(value)} B`;

	const units = ["KiB", "MiB", "GiB", "TiB"];
	let amount = value / 1024;
	let unit = units[0];
	for (const candidate of units.slice(1)) {
		if (amount < 1024) break;
		amount /= 1024;
		unit = candidate;
	}
	return `${formatNumber(amount)} ${unit}`;
}

function formatMilliseconds(value: number): string {
	return value >= 1000
		? `${formatNumber(value / 1000)} s`
		: `${formatNumber(value)} ms`;
}

function formatSeconds(value: number): string {
	if (value >= 3600 && value % 3600 === 0) {
		return `${formatNumber(value / 3600)} h`;
	}
	if (value >= 60 && value % 60 === 0) {
		return `${formatNumber(value / 60)} min`;
	}
	return `${formatNumber(value)} s`;
}

function enabled(value: boolean): string {
	return value ? "Enabled" : "Disabled";
}

function configured(value: boolean): string {
	return value ? "Configured" : "Not configured";
}

function RuntimeStatCard({
	title,
	rows,
}: {
	title: string;
	rows: RuntimeStat[];
}) {
	return (
		<article className="card">
			<h3 className="stat-card-title">{title}</h3>
			<ul className="stat-list">
				{rows.map((row) => (
					<li key={row.label}>
						<span>{row.label}</span>
						<strong>{row.value}</strong>
					</li>
				))}
			</ul>
		</article>
	);
}

export function RuntimeConfigPanel({ config }: { config: RunningConfig }) {
	const auth = config.authentication;
	const loginRateLimit = auth.login_rate_limit;
	const server = config.server;
	const network = config.network;
	const database = config.database;
	const pagination = config.pagination;
	const tasks = config.tasks;
	const remoteCalls = config.remote_calls;
	const events = config.events;
	const exportsConfig = config.exports;

	return (
		<div className="stats-grid">
			<RuntimeStatCard
				title="Server & network"
				rows={[
					{ label: "Listener", value: `${server.bind_ip}:${server.bind_port}` },
					{ label: "Actix workers", value: formatNumber(server.actix_workers) },
					{ label: "Log level", value: server.log_level },
					{
						label: "Metrics",
						value: server.metrics_enabled
							? `Enabled at ${server.metrics_path}`
							: "Disabled",
					},
					{
						label: "TLS",
						value: server.tls.enabled
							? `Enabled${server.tls.backend ? ` (${server.tls.backend})` : ""}`
							: "Disabled",
					},
					{
						label: "TLS certificate",
						value: configured(server.tls.certificate_path_configured),
					},
					{
						label: "Trust IP headers",
						value: enabled(network.trust_ip_headers),
					},
					{
						label: "Trusted proxy networks",
						value: formatNumber(network.trusted_proxy_networks),
					},
					{
						label: "Trusted proxy hops",
						value: formatNumber(network.trusted_proxy_hops),
					},
					{
						label: "Client allowlist",
						value: network.client_allowlist.allows_any
							? "Allows any client"
							: `${formatNumber(network.client_allowlist.network_count)} networks`,
					},
				]}
			/>

			<RuntimeStatCard
				title="Database & pagination"
				rows={[
					{ label: "Database URL", value: configured(database.url.configured) },
					{ label: "Pool size", value: formatNumber(database.pool_size) },
					{
						label: "Pool acquire timeout",
						value: formatMilliseconds(database.pool_acquire_timeout_ms),
					},
					{
						label: "Statement timeout",
						value: formatMilliseconds(database.statement_timeout_ms),
					},
					{
						label: "Default page limit",
						value: formatNumber(pagination.default_page_limit),
					},
					{
						label: "Maximum page limit",
						value: formatNumber(pagination.max_page_limit),
					},
					{
						label: "Maximum transitive depth",
						value: formatNumber(pagination.max_transitive_depth),
					},
				]}
			/>

			<RuntimeStatCard
				title="Tasks & remote calls"
				rows={[
					{ label: "Task workers", value: formatNumber(tasks.workers) },
					{
						label: "Task poll interval",
						value: formatMilliseconds(tasks.poll_interval_ms),
					},
					{
						label: "Imports per user",
						value: formatNumber(tasks.import_max_active_per_user),
					},
					{
						label: "Exports per user",
						value: formatNumber(tasks.export_max_active_per_user),
					},
					{
						label: "Remote calls per user",
						value: formatNumber(tasks.remote_call_max_active_per_user),
					},
					{
						label: "Remote call timeout",
						value: formatMilliseconds(remoteCalls.timeout_ms),
					},
					{
						label: "Remote response limit",
						value: formatBytes(remoteCalls.max_response_bytes),
					},
					{
						label: "Private remote targets",
						value: remoteCalls.allow_private_targets ? "Allowed" : "Blocked",
					},
				]}
			/>

			<RuntimeStatCard
				title="Authentication"
				rows={[
					{
						label: "Administrator group",
						value: formatScopedIdentityName(
							auth.admin_identity_scope,
							auth.admin_groupname,
						),
					},
					{
						label: "Token lifetime",
						value: `${formatNumber(auth.token_lifetime_hours)} h`,
					},
					{
						label: "Provider configuration",
						value: configured(auth.provider_config_path.configured),
					},
					{
						label: "Stable token hash key",
						value: configured(auth.stable_token_hash_key_configured),
					},
					{ label: "Login rate limit", value: enabled(loginRateLimit.enabled) },
					{
						label: "Attempts per identity / IP / subnet",
						value: `${loginRateLimit.max_attempts} / ${loginRateLimit.max_attempts_per_ip} / ${loginRateLimit.max_attempts_per_subnet}`,
					},
					{
						label: "Rate-limit window",
						value: formatSeconds(loginRateLimit.window_seconds),
					},
					{
						label: "Backoff range",
						value: `${formatSeconds(loginRateLimit.backoff_base_seconds)} – ${formatSeconds(loginRateLimit.backoff_max_seconds)}`,
					},
				]}
			/>

			<RuntimeStatCard
				title="Events"
				rows={[
					{
						label: "Fanout workers / batch",
						value: `${events.fanout_workers} / ${events.fanout_batch_size}`,
					},
					{
						label: "Fanout poll interval",
						value: formatMilliseconds(events.fanout_poll_interval_ms),
					},
					{
						label: "Delivery workers / batch",
						value: `${events.delivery_workers} / ${events.delivery_batch_size}`,
					},
					{
						label: "Delivery poll interval",
						value: formatMilliseconds(events.delivery_poll_interval_ms),
					},
					{
						label: "Delivery attempts",
						value: formatNumber(events.delivery_max_attempts),
					},
					{
						label: "Delivery transport timeout",
						value: formatMilliseconds(events.delivery_transport_timeout_ms),
					},
					{
						label: "Event / delivery retention",
						value: `${events.retention_days} / ${events.delivery_retention_days} days`,
					},
					{
						label: "Retention purge",
						value: enabled(events.retention_purge_enabled),
					},
					{
						label: "File archive",
						value: events.retention_file_archive_enabled
							? configured(events.retention_archive_path_configured)
							: "Disabled",
					},
				]}
			/>

			<RuntimeStatCard
				title="Exports"
				rows={[
					{
						label: "Output retention",
						value: `${formatNumber(exportsConfig.output_retention_hours)} h`,
					},
					{
						label: "Cleanup interval",
						value: formatSeconds(exportsConfig.output_cleanup_interval_seconds),
					},
					{
						label: "Maximum output",
						value: formatBytes(exportsConfig.max_output_bytes),
					},
					{
						label: "Stage timeout",
						value: formatMilliseconds(exportsConfig.stage_timeout_ms),
					},
					{
						label: "Database timeout",
						value: formatMilliseconds(
							exportsConfig.database_statement_timeout_ms,
						),
					},
					{
						label: "Template recursion limit",
						value: formatNumber(exportsConfig.template_recursion_limit),
					},
					{
						label: "Template object limit",
						value: formatNumber(exportsConfig.template_max_objects),
					},
					{
						label: "Template fuel",
						value: formatNumber(exportsConfig.template_fuel),
					},
				]}
			/>
		</div>
	);
}
