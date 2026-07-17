import { getApiErrorMessage } from "@/lib/api/errors";
import {
	getApiV1BackupsByTaskId,
	getGetApiV1BackupsByTaskIdOutputUrl,
	getApiV1RestoresByRestoreIdStatus,
	postApiV1Backups,
	postApiV1Restores,
	postApiV1RestoresByRestoreIdConfirm,
} from "@/lib/api/generated/client";
import type {
	BackupDocument,
	RestoreStageResponse,
	TaskResponse,
} from "@/lib/api/generated/models";

export const RESTORE_CONFIRMATION_PHRASE = "REPLACE ALL HUBUUM DATA";

export type BackupDownload = {
	blob: Blob;
	filename: string;
	sha256: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseBackupDocument(value: string): BackupDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("The selected file is not valid JSON.");
	}

	if (!isRecord(parsed) || !Number.isInteger(parsed.backup_version)) {
		throw new Error("The selected file is not a Hubuum backup document.");
	}

	return parsed as unknown as BackupDocument;
}

export function backupFilenameFromHeader(
	contentDisposition: string | null,
	taskId: number,
): string {
	const match = contentDisposition?.match(/filename="?([^";]+)"?/i);
	const candidate = match?.[1]?.trim().split(/[\\/]/).at(-1);
	return candidate?.endsWith(".json")
		? candidate
		: `hubuum-backup-${taskId}.json`;
}

export async function createBackupTask(
	includeHistory: boolean,
): Promise<TaskResponse> {
	const response = await postApiV1Backups(
		{ include_history: includeHistory },
		{ credentials: "include" },
	);
	if (response.status !== 202) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to create system backup."),
		);
	}
	return response.data;
}

export async function fetchBackupTask(taskId: number): Promise<TaskResponse> {
	const response = await getApiV1BackupsByTaskId(taskId, {
		credentials: "include",
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load backup status."),
		);
	}
	return response.data;
}

export async function downloadBackupDocument(
	taskId: number,
): Promise<BackupDownload> {
	const response = await fetch(getGetApiV1BackupsByTaskIdOutputUrl(taskId), {
		credentials: "include",
	});
	if (!response.ok) {
		const payload = await response.json().catch(() => null);
		throw new Error(
			getApiErrorMessage(payload, "Failed to download backup document."),
		);
	}

	return {
		blob: await response.blob(),
		filename: backupFilenameFromHeader(
			response.headers.get("content-disposition"),
			taskId,
		),
		sha256: response.headers.get("x-hubuum-backup-sha256"),
	};
}

export async function stageRestoreDocument(
	document: BackupDocument,
): Promise<{ capability: string; stage: RestoreStageResponse }> {
	const response = await postApiV1Restores(document, {
		credentials: "include",
	});
	if (response.status !== 201) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to stage restore document."),
		);
	}

	const capability = response.data.restore_capability;
	if (!capability) {
		throw new Error("The server did not return a restore capability.");
	}

	return {
		capability,
		stage: { ...response.data, restore_capability: null },
	};
}

export async function fetchRestoreStatus(
	restoreId: number,
	capability: string,
): Promise<RestoreStageResponse> {
	const response = await getApiV1RestoresByRestoreIdStatus(restoreId, {
		credentials: "include",
		headers: { "X-Hubuum-Restore-Capability": capability },
	});
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load restore status."),
		);
	}
	return response.data;
}

export async function confirmRestore(
	restoreId: number,
	capability: string,
	sha256: string,
): Promise<RestoreStageResponse> {
	const response = await postApiV1RestoresByRestoreIdConfirm(
		restoreId,
		{
			confirmation: RESTORE_CONFIRMATION_PHRASE,
			restore_capability: capability,
			sha256,
		},
		{ credentials: "include" },
	);
	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "System restore failed."),
		);
	}
	return response.data;
}
