"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { JsonViewer } from "@/components/json-viewer";
import {
	fetchPrincipalSettings,
	savePrincipalSettings,
} from "@/lib/api/admin-security";
import { useConfirm } from "@/lib/confirm-context";
import type { SettingsEditMode } from "@/lib/principal-settings-edit";
type Snapshot = Awaited<ReturnType<typeof fetchPrincipalSettings>>;
function SettingsEditor({
	id,
	snapshot: initialSnapshot,
}: {
	id: number;
	snapshot: Snapshot;
}) {
	const client = useQueryClient();
	const confirm = useConfirm();
	// Keep the revision paired with the draft until an explicit reload or save.
	const [snapshot, setSnapshot] = useState(initialSnapshot);
	const [mode, setMode] = useState<SettingsEditMode>("replace");
	const [text, setText] = useState(JSON.stringify(snapshot.settings, null, 2));
	const save = useMutation({
		mutationFn: (operation: SettingsEditMode | "reset") => {
			if (!snapshot.etag)
				throw new Error(
					"The server did not supply a settings revision. Reload before editing.",
				);
			return savePrincipalSettings(id, snapshot.etag, operation, text);
		},
		onSuccess: (data) => {
			setSnapshot(data);
			setMode("replace");
			setText(JSON.stringify(data.settings, null, 2));
			client.setQueryData(["admin-principal-settings", id], data);
		},
	});
	async function submit(operation: SettingsEditMode | "reset") {
		if (save.isPending) return;
		if (
			await confirm({
				title:
					operation === "reset"
						? `Reset settings for principal #${id}?`
						: `Save settings for principal #${id}?`,
				description:
					operation === "reset"
						? "This removes every preference in this principal's settings document."
						: "This changes the selected principal's preferences. A concurrent update will be rejected; reload to review it.",
				confirmLabel:
					operation === "reset" ? "Reset settings" : "Save settings",
				tone: operation === "reset" ? "danger" : undefined,
			})
		)
			save.mutate(operation);
	}
	return (
		<div className="stack">
			<p>
				Principal #{id} · revision {snapshot.revision}. Reloading discards the
				editor draft.
			</p>
			<details>
				<summary>Stored settings</summary>
				<JsonViewer value={snapshot.settings} />
			</details>
			<fieldset className="stack" disabled={save.isPending}>
				<legend>Edit settings</legend>
				<label className="control-field">
					<span>Settings operation</span>
					<select
						value={mode}
						onChange={(e) => {
							const next = e.target.value as SettingsEditMode;
							setMode(next);
							setText(
								next === "replace"
									? JSON.stringify(snapshot.settings, null, 2)
									: next === "merge"
										? "{}"
										: "[]",
							);
							save.reset();
						}}
					>
						<option value="replace">Replace document</option>
						<option value="merge">JSON Merge Patch</option>
						<option value="patch">JSON Patch</option>
					</select>
				</label>
				<p className="muted">
					{mode === "replace"
						? "Replace the complete JSON object, including literal null values."
						: mode === "merge"
							? "Merge object keys recursively. A null value removes a key."
							: "Apply add, remove, replace, move, copy, or test operations using JSON Pointer paths. The resulting root must remain an object."}
				</p>
				<label className="control-field">
					<span>Settings JSON</span>
					<textarea
						rows={14}
						spellCheck={false}
						value={text}
						onChange={(e) => setText(e.target.value)}
					/>
				</label>
			</fieldset>
			<div className="action-row">
				<button
					type="button"
					disabled={!snapshot.etag}
					aria-disabled={save.isPending}
					onClick={() => void submit(mode)}
				>
					Save settings
				</button>
				<button
					type="button"
					disabled={!snapshot.etag}
					aria-disabled={save.isPending}
					className="danger"
					onClick={() => void submit("reset")}
				>
					Reset settings
				</button>
			</div>
			{!snapshot.etag ? (
				<p role="alert">
					The server did not supply an ETag. Editing is unavailable.
				</p>
			) : null}
			{save.isError ? <p role="alert">{save.error.message}</p> : null}
			{save.isSuccess ? <p role="status">Settings saved.</p> : null}
		</div>
	);
}
export function AdminPrincipalSettings({
	principalId,
}: {
	principalId?: number;
}) {
	const [draft, setDraft] = useState(principalId?.toString() ?? "");
	const [selectedId, setId] = useState<number>();
	const id = principalId ?? selectedId;
	const [reload, setReload] = useState(0);
	const query = useQuery({
		queryKey: ["admin-principal-settings", id],
		queryFn: () => fetchPrincipalSettings(id as number),
		enabled: id !== undefined,
	});
	return (
		<section className="card stack" aria-label="Principal settings">
			<h3>Principal settings</h3>
			{!principalId ? (
				<form
					className="action-row"
					onSubmit={(e) => {
						e.preventDefault();
						setId(Number(draft));
					}}
				>
					<label className="control-field">
						<span>Principal ID</span>
						<input
							type="number"
							required
							min={1}
							step={1}
							max={2147483647}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
						/>
					</label>
					<button type="submit">Inspect settings</button>
				</form>
			) : null}
			<p className="muted">
				Inspect and manage local preferences for a user or service account.
			</p>
			{id !== undefined ? (
				<button
					type="button"
					className="secondary"
					disabled={query.isFetching}
					onClick={async () => {
						const result = await query.refetch();
						if (result.isSuccess) setReload((value) => value + 1);
					}}
				>
					Reload settings
				</button>
			) : null}
			{query.isFetching ? <p role="status">Loading settings…</p> : null}
			{query.isError ? <p role="alert">{query.error.message}</p> : null}
			{query.data ? (
				<SettingsEditor
					key={`${id}-${reload}`}
					id={id as number}
					snapshot={query.data}
				/>
			) : null}
		</section>
	);
}
