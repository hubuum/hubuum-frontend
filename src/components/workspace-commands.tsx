"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { QuickSearch, type QuickSearchOption } from "@/components/quick-search";
import { getPinnedItems } from "@/lib/pinned-items";
import { USER_SETTINGS_CHANGED_EVENT } from "@/lib/user-settings-client";

function pinnedDestinations() {
	return getPinnedItems().map((item) => ({
		label: item.name,
		detail: `${item.type === "object" ? "Object" : item.type === "class" ? "Class" : "Collection"} #${item.id}${item.classId ? ` · Class #${item.classId}` : ""}${item.collectionId ? ` · Collection #${item.collectionId}` : ""} · Pinned`,
		href:
			item.type === "object"
				? `/objects/${item.classId}/${item.id}`
				: `/${item.type === "class" ? "classes" : "collections"}/${item.id}`,
	}));
}

export function PinnedNavigation() {
	const [pins, setPins] = useState<ReturnType<typeof pinnedDestinations>>([]);
	useEffect(() => {
		const sync = () => setPins(pinnedDestinations());
		sync();
		window.addEventListener(USER_SETTINGS_CHANGED_EVENT, sync);
		return () => window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, sync);
	}, []);
	if (!pins.length) return null;
	return (
		<nav className="workspace-pinned-nav" aria-label="Pinned destinations">
			<span className="muted">Pinned</span>
			{pins.slice(0, 3).map((pin) => (
				<Link key={pin.href} href={pin.href} prefetch={false}>
					{pin.label}
				</Link>
			))}
		</nav>
	);
}

export function WorkspaceCommands({
	open,
	onClose,
	canViewAdmin,
	createLabel,
	onCreate,
}: {
	open: boolean;
	onClose: () => void;
	canViewAdmin: boolean;
	createLabel?: string;
	onCreate?: () => void;
}) {
	const [search, setSearch] = useState("");
	const [pins, setPins] = useState<ReturnType<typeof pinnedDestinations>>([]);
	useEffect(() => {
		if (open) {
			setSearch("");
			setPins(pinnedDestinations());
		}
	}, [open]);
	const destinations = [
		...pins,
		...[
			"Home",
			"Collections",
			"Classes",
			"Objects",
			"Relations",
			"Exports",
			"Imports",
			"Tasks",
			"Audit",
			"Account",
			"About",
		].map((label) => ({
			label,
			href: label === "Home" ? "/app" : `/${label.toLowerCase()}`,
		})),
		...(canViewAdmin
			? [
					{ label: "Users", href: "/admin/users" },
					{ label: "Groups", href: "/admin/groups" },
					{ label: "Service accounts", href: "/admin/service-accounts" },
					{ label: "Backup & restore", href: "/admin/backups" },
					{ label: "Remote targets", href: "/admin/remote-targets" },
					{ label: "Security", href: "/admin/security" },
					{ label: "Configuration", href: "/admin/configuration" },
					{ label: "Statistics", href: "/statistics" },
				]
			: []),
	].filter((item) =>
		item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
	);
	const options: QuickSearchOption[] = [
		...(onCreate &&
		createLabel?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
			? [
					{
						id: "create",
						label: createLabel,
						onSelect: () => {
							onClose();
							window.requestAnimationFrame(onCreate);
						},
					},
				]
			: []),
		...new Map(destinations.map((item) => [item.href, item])).values(),
	];
	return (
		<CreateModal
			open={open}
			title="Go to or create"
			onClose={onClose}
			panelClassName="command-dialog"
		>
			<div className="stack">
				<label htmlFor="command-search">Find a destination or action</label>
				<QuickSearch
					inputId="command-search"
					label="Find a destination or action"
					value={search}
					onChange={setSearch}
					placeholder="Objects, tasks, create…"
					searchHref={`/search?q=${encodeURIComponent(search.trim())}`}
					localOptions={options}
					onNavigate={onClose}
				/>
			</div>
		</CreateModal>
	);
}
