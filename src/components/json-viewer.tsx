"use client";

import { useDeferredValue, useState } from "react";

type JsonViewerTab = "overview" | "tree" | "json";

type JsonViewerProps = {
	value: unknown;
	defaultTab?: JsonViewerTab;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `Array (${value.length})`;
	}

	if (isRecord(value)) {
		return `Object (${Object.keys(value).length})`;
	}

	if (value === null) {
		return "null";
	}

	if (typeof value === "string") {
		return value.length > 48 ? `${value.slice(0, 48)}...` : value;
	}

	return String(value);
}

function renderPrimitive(value: unknown): string {
	if (typeof value === "string") {
		return `"${value}"`;
	}

	if (value === null) {
		return "null";
	}

	return String(value);
}

function buildArrayChildSignature(value: unknown): string {
	if (typeof value === "string") {
		return `s:${value}`;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return `p:${String(value)}`;
	}

	return `j:${JSON.stringify(value)}`;
}

function JsonTreeNode({
	label,
	value,
	depth,
	path,
}: {
	label: string;
	value: unknown;
	depth: number;
	path: string;
}) {
	if (Array.isArray(value)) {
		const seenSignatures = new Map<string, number>();
		const childNodes = value.map((item, index) => {
			const signature = buildArrayChildSignature(item);
			const occurrence = (seenSignatures.get(signature) ?? 0) + 1;
			seenSignatures.set(signature, occurrence);
			const childPath = `${path}[${signature}#${occurrence}]`;

			return (
				<JsonTreeNode
					key={childPath}
					label={`[${index}]`}
					value={item}
					depth={depth + 1}
					path={childPath}
				/>
			);
		});

		return (
			<details className="json-tree-node" open={depth < 1}>
				<summary>
					<span className="json-tree-key">{label}</span>
					<span className="json-tree-meta">Array ({value.length})</span>
				</summary>
				<div className="json-tree-children">{childNodes}</div>
			</details>
		);
	}

	if (isRecord(value)) {
		const entries = Object.entries(value);
		return (
			<details className="json-tree-node" open={depth < 1}>
				<summary>
					<span className="json-tree-key">{label}</span>
					<span className="json-tree-meta">Object ({entries.length})</span>
				</summary>
				<div className="json-tree-children">
					{entries.map(([entryKey, entryValue]) => (
						<JsonTreeNode
							key={`${path}.${entryKey}`}
							label={entryKey}
							value={entryValue}
							depth={depth + 1}
							path={`${path}.${entryKey}`}
						/>
					))}
				</div>
			</details>
		);
	}

	return (
		<div className="json-tree-leaf">
			<span className="json-tree-key">{label}</span>
			<code>{renderPrimitive(value)}</code>
		</div>
	);
}

export function JsonViewer({
	value,
	defaultTab = "overview",
}: JsonViewerProps) {
	const [activeTab, setActiveTab] = useState<JsonViewerTab>(defaultTab);
	const [overviewFilter, setOverviewFilter] = useState("");
	const deferredOverviewFilter = useDeferredValue(overviewFilter);
	const rawJson = JSON.stringify(value, null, 2) ?? "null";
	const overviewEntries = Array.isArray(value)
		? value.map((item, index) => ({
				label: `[${index}]`,
				value: summarizeValue(item),
			}))
		: isRecord(value)
			? Object.entries(value)
					.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
					.map(([entryKey, entryValue]) => ({
						label: entryKey,
						value: summarizeValue(entryValue),
					}))
			: [];
	const normalizedOverviewFilter = deferredOverviewFilter.trim().toLowerCase();
	const filteredOverviewEntries = normalizedOverviewFilter
		? overviewEntries.filter((entry) => {
				return (
					entry.label.toLowerCase().includes(normalizedOverviewFilter) ||
					entry.value.toLowerCase().includes(normalizedOverviewFilter)
				);
			})
		: overviewEntries;

	return (
		<div className="json-viewer">
			<div className="json-viewer-header">
				<div
					className="json-viewer-tabs"
					role="tablist"
					aria-label="JSON views"
				>
					{(["overview", "tree", "json"] as JsonViewerTab[]).map((tab) => (
						<button
							key={tab}
							type="button"
							role="tab"
							className={`json-viewer-tab${activeTab === tab ? " is-active" : ""}`}
							aria-selected={activeTab === tab}
							onClick={() => setActiveTab(tab)}
						>
							{tab === "json" ? "JSON" : tab[0].toUpperCase() + tab.slice(1)}
						</button>
					))}
				</div>

				{activeTab === "overview" && overviewEntries.length > 0 ? (
					<label className="json-overview-filter">
						<span className="sr-only">Filter overview fields</span>
						<input
							type="search"
							value={overviewFilter}
							onChange={(event) => setOverviewFilter(event.target.value)}
							placeholder="Filter keys or values"
						/>
					</label>
				) : null}
			</div>

			{activeTab === "overview" ? (
				<div className="json-viewer-panel" role="tabpanel">
					{overviewEntries.length > 0 ? (
						<div className="json-overview-list-wrap">
							<div className="json-overview-list">
								{filteredOverviewEntries.map((entry) => (
									<div key={entry.label} className="json-overview-row">
										<span className="json-overview-key">{entry.label}</span>
										<span className="json-overview-value">{entry.value}</span>
									</div>
								))}
							</div>
						</div>
					) : (
						<div className="muted">
							This JSON value does not have child fields to summarize.
						</div>
					)}

					{overviewEntries.length > 0 &&
					filteredOverviewEntries.length === 0 ? (
						<div className="muted">No matching fields in the overview.</div>
					) : null}
				</div>
			) : null}

			{activeTab === "tree" ? (
				<div className="json-viewer-panel" role="tabpanel">
					<div className="json-tree-shell">
						<JsonTreeNode label="$" value={value} depth={0} path="$" />
					</div>
				</div>
			) : null}

			{activeTab === "json" ? (
				<div className="json-viewer-panel" role="tabpanel">
					<pre className="object-json-code is-expanded">{rawJson}</pre>
				</div>
			) : null}
		</div>
	);
}
