import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1RemoteTargetsByRemoteTargetIdHistory,
	getApiV1RemoteTargetsByRemoteTargetIdHistoryAsOf,
	getApiV1ExportTemplatesByTemplateIdHistoryAsOf,
} from "@/lib/api/generated/client";
import type {
	HistoryResponseRemoteTargetHistory,
	HistoryResponseExportTemplateHistory,
} from "@/lib/api/generated/models";
import { listReportTemplateHistory } from "@/lib/api/reporting";
import { historyInstant } from "@/lib/resource-history";
export type ConfigurationHistoryKind = "remote_target" | "export_template";
export type ConfigurationHistoryRecord =
	| HistoryResponseRemoteTargetHistory
	| HistoryResponseExportTemplateHistory;
export async function fetchConfigurationHistory(
	kind: ConfigurationHistoryKind,
	id: number,
	cursor?: string,
): Promise<{ items: ConfigurationHistoryRecord[]; nextCursor: string | null }> {
	if (kind === "export_template") return listReportTemplateHistory(id, cursor);
	const response = await getApiV1RemoteTargetsByRemoteTargetIdHistory(
		id,
		{ cursor, limit: 50, sort: "-history_id", include_total: false },
		{ credentials: "include" },
	);
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to load remote-target history.",
			),
		);
	return {
		items: response.data,
		nextCursor: response.headers.get("X-Next-Cursor"),
	};
}
export async function fetchConfigurationSnapshot(
	kind: ConfigurationHistoryKind,
	id: number,
	at: string,
): Promise<ConfigurationHistoryRecord | null> {
	if (historyInstant(at) === null)
		throw new Error(
			"Enter an RFC3339 timestamp with a timezone, for example 2026-10-01T12:00:00.123456Z.",
		);
	const response =
		kind === "remote_target"
			? await getApiV1RemoteTargetsByRemoteTargetIdHistoryAsOf(
					id,
					{ at },
					{ credentials: "include" },
				)
			: await getApiV1ExportTemplatesByTemplateIdHistoryAsOf(
					id,
					{ at },
					{ credentials: "include" },
				);
	if (response.status === 404) return null;
	if (response.status !== 200)
		throw new Error(
			getApiErrorMessage(
				response.data,
				"Failed to load the historical snapshot.",
			),
		);
	return response.data;
}
