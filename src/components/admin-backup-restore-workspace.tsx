"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ChangeEvent, useRef, useState } from "react";

import { useConfirm } from "@/lib/confirm-context";
import {
	confirmRestore,
	createBackupTask,
	downloadBackupDocument,
	fetchRestoreStatus,
	parseBackupDocument,
	RESTORE_CONFIRMATION_PHRASE,
	stageRestoreDocument,
} from "@/lib/api/backup-restore";
import type {
	BackupTaskDetails,
	RestoreStageResponse,
	TaskResponse,
} from "@/lib/api/generated/models";
import { fetchTasks, isTerminalTaskStatus } from "@/lib/api/tasking";

type StagedRestore = {
	capability: string;
	stage: RestoreStageResponse;
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatDate(value: string | null | undefined): string {
	if (!value) return "n/a";
	const timestamp = Date.parse(value);
	return Number.isNaN(timestamp) ? value : dateFormatter.format(timestamp);
}

function formatBytes(value: number | null | undefined): string {
	if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
	if (value < 1024) return `${value} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let amount = value / 1024;
	let unit = units[0];
	for (const candidate of units.slice(1)) {
		if (amount < 1024) break;
		amount /= 1024;
		unit = candidate;
	}
	return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${unit}`;
}

function backupDetails(task: TaskResponse): BackupTaskDetails | null {
	return task.details?.backup ?? null;
}

function BackupTaskRow({ task }: { task: TaskResponse }) {
	const details = backupDetails(task);
	const [downloadError, setDownloadError] = useState<string | null>(null);
	const [isDownloading, setIsDownloading] = useState(false);

	async function download() {
		setDownloadError(null);
		setIsDownloading(true);
		try {
			const result = await downloadBackupDocument(task.id);
			const objectUrl = URL.createObjectURL(result.blob);
			const anchor = document.createElement("a");
			anchor.href = objectUrl;
			anchor.download = result.filename;
			anchor.click();
			URL.revokeObjectURL(objectUrl);
		} catch (error) {
			setDownloadError(
				error instanceof Error ? error.message : "Backup download failed.",
			);
		} finally {
			setIsDownloading(false);
		}
	}

	return (
		<article className="card stack panel-card">
			<div className="relations-toolbar">
				<div className="stack action-card-header">
					<strong>Backup #{task.id}</strong>
					<span className="muted">Created {formatDate(task.created_at)}</span>
				</div>
				<span
					className={`status-pill status-pill--${
						task.status === "succeeded"
							? "success"
							: task.status === "failed" || task.status === "cancelled"
								? "danger"
								: "accent"
					}`}
				>
					{task.status.replaceAll("_", " ")}
				</span>
			</div>

			<div className="summary-grid">
				<div className="summary-pill">
					<span>Size</span>
					<strong>{formatBytes(details?.byte_size)}</strong>
				</div>
				<div className="summary-pill">
					<span>Available until</span>
					<strong>{formatDate(details?.output_expires_at)}</strong>
				</div>
				<div className="summary-pill">
					<span>SHA-256</span>
					<strong title={details?.sha256 ?? undefined}>
						{details?.sha256 ? `${details.sha256.slice(0, 12)}…` : "n/a"}
					</strong>
				</div>
			</div>

			{task.summary ? <p className="muted">{task.summary}</p> : null}
			{downloadError ? (
				<div className="error-banner" role="alert">
					{downloadError}
				</div>
			) : null}
			<div className="action-card-actions">
				<button
					type="button"
					onClick={download}
					disabled={
						isDownloading ||
						!details?.output_available ||
						details.output_expired
					}
				>
					{isDownloading ? "Downloading…" : "Download JSON"}
				</button>
				<Link className="link-chip" href={`/tasks/${task.id}`}>
					Task details
				</Link>
			</div>
		</article>
	);
}

export function AdminBackupRestoreWorkspace() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [includeHistory, setIncludeHistory] = useState(true);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [staged, setStaged] = useState<StagedRestore | null>(null);
	const [confirmation, setConfirmation] = useState("");
	const [restoreComplete, setRestoreComplete] = useState(false);

	const backupsQuery = useQuery({
		queryKey: ["admin-backup-tasks"],
		queryFn: async () =>
			(await fetchTasks({ kind: "backup", limit: 20 })).tasks,
		refetchInterval: (query) =>
			query.state.data?.some((task) => !isTerminalTaskStatus(task.status))
				? 2_000
				: 15_000,
	});

	const createMutation = useMutation({
		mutationFn: () => createBackupTask(includeHistory),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["admin-backup-tasks"],
			});
		},
	});

	const stageMutation = useMutation({
		mutationFn: async (file: File) =>
			stageRestoreDocument(parseBackupDocument(await file.text())),
		onSuccess: (result) => {
			setStaged(result);
			setConfirmation("");
			setSelectedFile(null);
			if (fileInputRef.current) fileInputRef.current.value = "";
		},
	});

	const statusQuery = useQuery({
		queryKey: ["admin-restore-status", staged?.stage.id],
		queryFn: async () => {
			if (!staged) throw new Error("No restore is staged.");
			return fetchRestoreStatus(staged.stage.id, staged.capability);
		},
		enabled: staged !== null && !restoreComplete,
		refetchInterval: 5_000,
	});

	const currentStage = statusQuery.data ?? staged?.stage ?? null;

	const confirmMutation = useMutation({
		mutationFn: async () => {
			if (!staged) throw new Error("No restore is staged.");
			return confirmRestore(
				staged.stage.id,
				staged.capability,
				staged.stage.sha256,
			);
		},
		onSuccess: () => {
			setRestoreComplete(true);
			setStaged(null);
			setConfirmation("");
		},
	});

	function onFileChange(event: ChangeEvent<HTMLInputElement>) {
		setSelectedFile(event.target.files?.[0] ?? null);
		stageMutation.reset();
	}

	async function onConfirmRestore() {
		if (!staged || confirmation !== RESTORE_CONFIRMATION_PHRASE) return;
		const accepted = await confirm({
			title: "Replace all Hubuum data?",
			description:
				"This destructive restore replaces the entire database, including identities and permissions. Existing sessions and tokens will stop working.",
			confirmLabel: "Replace all data",
			tone: "danger",
		});
		if (accepted) confirmMutation.mutate();
	}

	return (
		<section className="stack">
			<header className="stack action-card-header">
				<div className="stack action-card-header">
					<p className="eyebrow">Admin</p>
					<h2>Backup &amp; restore</h2>
				</div>
				<p className="muted">
					Create portable JSON backups and stage a validated full-system
					restore. Only unscoped administrators can use these operations.
				</p>
			</header>

			<div className="grid cols-2">
				<article className="card stack panel-card">
					<h3>Create backup</h3>
					<p className="muted">
						Backup generation runs as a background task. Download the output
						before its configured retention period expires.
					</p>
					<label className="checkbox-row">
						<input
							type="checkbox"
							checked={includeHistory}
							onChange={(event) => setIncludeHistory(event.target.checked)}
						/>
						Include audit and resource history
					</label>
					{createMutation.isError ? (
						<div className="error-banner" role="alert">
							{createMutation.error.message}
						</div>
					) : null}
					<button
						type="button"
						onClick={() => createMutation.mutate()}
						disabled={createMutation.isPending}
					>
						{createMutation.isPending ? "Starting…" : "Create backup"}
					</button>
				</article>

				<article className="card stack panel-card">
					<h3>Stage restore</h3>
					<div className="error-banner">
						A confirmed restore replaces every Hubuum record. Staging only
						validates the document and does not alter live data.
					</div>
					<label className="control-field">
						<span>Hubuum backup document</span>
						<input
							ref={fileInputRef}
							type="file"
							accept="application/json,.json"
							onChange={onFileChange}
						/>
					</label>
					{selectedFile ? (
						<p className="muted">
							{selectedFile.name} · {formatBytes(selectedFile.size)}
						</p>
					) : null}
					{stageMutation.isError ? (
						<div className="error-banner" role="alert">
							{stageMutation.error.message}
						</div>
					) : null}
					<button
						type="button"
						onClick={() => selectedFile && stageMutation.mutate(selectedFile)}
						disabled={!selectedFile || stageMutation.isPending}
					>
						{stageMutation.isPending ? "Validating…" : "Validate and stage"}
					</button>
				</article>
			</div>

			{currentStage ? (
				<article className="card stack panel-card">
					<div className="relations-toolbar">
						<div>
							<p className="eyebrow">Restore #{currentStage.id}</p>
							<h3>Validated backup</h3>
						</div>
						<span className="status-pill status-pill--accent">
							{currentStage.status}
						</span>
					</div>
					<div className="summary-grid">
						<div className="summary-pill">
							<span>Backup version</span>
							<strong>{currentStage.validation.backup_version}</strong>
						</div>
						<div className="summary-pill">
							<span>Source server</span>
							<strong>{currentStage.validation.source_version}</strong>
						</div>
						<div className="summary-pill">
							<span>Items</span>
							<strong>{currentStage.validation.total_items}</strong>
						</div>
						<div className="summary-pill">
							<span>History</span>
							<strong>
								{currentStage.validation.includes_history
									? "Included"
									: "Excluded"}
							</strong>
						</div>
						<div className="summary-pill">
							<span>Expires</span>
							<strong>{formatDate(currentStage.expires_at)}</strong>
						</div>
						<div className="summary-pill">
							<span>SHA-256</span>
							<strong title={currentStage.sha256}>
								{currentStage.sha256.slice(0, 12)}…
							</strong>
						</div>
					</div>
					<label className="control-field control-field--wide">
						<span>
							Type <code>{RESTORE_CONFIRMATION_PHRASE}</code> to enable restore
						</span>
						<input
							value={confirmation}
							onChange={(event) => setConfirmation(event.target.value)}
							autoComplete="off"
						/>
					</label>
					{statusQuery.isError ? (
						<div className="error-banner" role="alert">
							{statusQuery.error.message}
						</div>
					) : null}
					{confirmMutation.isError ? (
						<div className="error-banner" role="alert">
							{confirmMutation.error.message}
						</div>
					) : null}
					<button
						className="danger"
						type="button"
						onClick={onConfirmRestore}
						disabled={
							confirmation !== RESTORE_CONFIRMATION_PHRASE ||
							confirmMutation.isPending
						}
					>
						{confirmMutation.isPending
							? "Replacing all data…"
							: "Replace all Hubuum data"}
					</button>
				</article>
			) : null}

			{restoreComplete ? (
				<div className="card stack panel-card" role="status">
					<h3>Restore completed</h3>
					<p>
						All previous sessions and tokens are invalid. Sign in with
						credentials from the restored backup.
					</p>
					<Link className="link-chip" href="/login">
						Sign in again
					</Link>
				</div>
			) : null}

			<div className="stack">
				<div className="relations-toolbar">
					<h3>Recent backup tasks</h3>
					<button
						className="ghost"
						type="button"
						onClick={() => backupsQuery.refetch()}
						disabled={backupsQuery.isFetching}
					>
						Refresh
					</button>
				</div>
				{backupsQuery.isError ? (
					<div className="error-banner" role="alert">
						{backupsQuery.error.message}
					</div>
				) : null}
				{backupsQuery.isLoading ? <p>Loading backups…</p> : null}
				{backupsQuery.data?.length === 0 ? (
					<p className="muted">No backup tasks are visible yet.</p>
				) : null}
				{backupsQuery.data?.map((task) => (
					<BackupTaskRow key={task.id} task={task} />
				))}
			</div>
		</section>
	);
}
