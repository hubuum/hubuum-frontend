"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { PinnedClass, RecentItem } from "@/types/quick-access";
import {
	clearRecentItems,
	getRecentItems,
} from "@/lib/recent-items";
import { getPinnedClasses, unpinClass } from "@/lib/pinned-classes";

function IconNamespace() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10 4 8 6H4a2 2 0 0 0-2 2v1h20V8a2 2 0 0 0-2-2h-8l-2-2Zm12 7H2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconClass() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3 3 7.5 12 12l9-4.5zm-9 7.7V17l9 4.5V15zm18 0L12 15v6.5L21 17z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconObject() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M3 7 12 2l9 5v10l-9 5-9-5zm9-3.3L6 7l6 3.3L18 7zm-7 5v7l6 3.3v-7z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconClose() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4z"
				fill="currentColor"
			/>
		</svg>
	);
}

function getItemIcon(type: RecentItem["type"]) {
	switch (type) {
		case "namespace":
			return <IconNamespace />;
		case "class":
			return <IconClass />;
		case "object":
			return <IconObject />;
	}
}

function getItemHref(item: RecentItem): string {
	switch (item.type) {
		case "namespace":
			return `/namespaces/${item.id}`;
		case "class":
			return `/classes/${item.id}`;
		case "object":
			return `/objects/${item.classId}/${item.id}`;
	}
}

function formatTimestamp(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) {
		return "Just now";
	}
	if (minutes < 60) {
		return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
	}
	if (hours < 24) {
		return `${hours} hour${hours === 1 ? "" : "s"} ago`;
	}
	return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function QuickAccessPanel() {
	const router = useRouter();
	const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
	const [pinnedClasses, setPinnedClasses] = useState<PinnedClass[]>([]);

	useEffect(() => {
		setRecentItems(getRecentItems().slice(0, 10));
		setPinnedClasses(getPinnedClasses());
	}, []);

	function handleClearRecent() {
		if (
			window.confirm(
				"Clear all recent items? This action cannot be undone.",
			)
		) {
			clearRecentItems();
			setRecentItems([]);
		}
	}

	function handleUnpin(classId: number) {
		unpinClass(classId);
		setPinnedClasses(getPinnedClasses());
	}

	function handlePinnedClick(classId: number) {
		router.push(`/objects?create=1&classId=${classId}`);
	}

	return (
		<div className="quick-access-panel card stack">
			<section className="stack">
				<div className="quick-access-header">
					<h2 className="eyebrow">Recent Items</h2>
					{recentItems.length > 0 ? (
						<button
							type="button"
							className="ghost quick-access-clear"
							onClick={handleClearRecent}
						>
							Clear
						</button>
					) : null}
				</div>

				{recentItems.length === 0 ? (
					<div className="quick-access-empty">
						<p className="muted">No recent items yet</p>
						<p className="muted quick-access-empty-subtext">
							Items you view will appear here for quick access
						</p>
					</div>
				) : (
					<ul className="recent-items-list">
						{recentItems.map((item) => (
							<li key={`${item.type}-${item.id}`}>
								<Link
									href={getItemHref(item)}
									className="recent-item-link"
								>
									<span className="recent-item-icon">
										{getItemIcon(item.type)}
									</span>
									<span className="recent-item-content">
										<span className="recent-item-name">{item.name}</span>
										<span className="recent-item-meta">
											{item.type.charAt(0).toUpperCase() + item.type.slice(1)}{" "}
											• {formatTimestamp(item.timestamp)}
										</span>
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</section>

			<section className="stack">
				<h2 className="eyebrow">Pinned Shortcuts</h2>

				{pinnedClasses.length === 0 ? (
					<div className="quick-access-empty">
						<p className="muted">No pinned classes yet</p>
						<p className="muted quick-access-empty-subtext">
							Pin your favorite classes for quick object creation
						</p>
					</div>
				) : (
					<ul className="pinned-shortcuts-list">
						{pinnedClasses.map((item) => (
							<li key={item.classId}>
								<button
									type="button"
									className="pinned-item-link"
									onClick={() => handlePinnedClick(item.classId)}
								>
									<span className="pinned-item-icon">
										<IconClass />
									</span>
									<span className="pinned-item-content">
										<span className="pinned-item-name">
											{item.className}
										</span>
										<span className="pinned-item-meta">
											{item.namespaceName}
										</span>
									</span>
								</button>
								<button
									type="button"
									className="ghost icon-button pinned-item-unpin"
									onClick={() => handleUnpin(item.classId)}
									aria-label={`Unpin ${item.className}`}
								>
									<IconClose />
								</button>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}
