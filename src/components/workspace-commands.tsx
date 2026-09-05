"use client";

import Link from "next/link";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { CreateModal } from "@/components/create-modal";
import { getPinnedItems } from "@/lib/pinned-items";
import { USER_SETTINGS_CHANGED_EVENT } from "@/lib/user-settings-client";

function pinnedDestinations() {
	return getPinnedItems().map((item) => ({
		label: item.name,
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
	const listRef = useRef<HTMLDivElement | null>(null);
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
					{ label: "Configuration", href: "/admin/configuration" },
					{ label: "Statistics", href: "/statistics" },
				]
			: []),
	].filter((item) =>
		item.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
	);
	function navigateOptions(event: KeyboardEvent<HTMLElement>) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const options = Array.from(
			listRef.current?.querySelectorAll<HTMLElement>("a, button") ?? [],
		);
		if (!options.length) return;
		event.preventDefault();
		const index = options.indexOf(document.activeElement as HTMLElement);
		if (index === -1) {
			options[event.key === "ArrowDown" ? 0 : options.length - 1]?.focus();
			return;
		}
		options[
			(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
				options.length
		]?.focus();
	}
	return (
		<CreateModal
			open={open}
			title="Go to or create"
			onClose={onClose}
			panelClassName="command-dialog"
		>
			<div className="stack">
				<label className="control-field">
					Find a destination or action
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onKeyDown={navigateOptions}
						placeholder="Objects, tasks, create…"
					/>
				</label>
				<div className="command-options" ref={listRef}>
					{onCreate &&
					createLabel
						?.toLocaleLowerCase()
						.includes(search.trim().toLocaleLowerCase()) ? (
						<button
							type="button"
							onKeyDown={navigateOptions}
							onClick={() => {
								onClose();
								window.requestAnimationFrame(onCreate);
							}}
						>
							{createLabel}
						</button>
					) : null}
					{[
						...new Map(destinations.map((item) => [item.href, item])).values(),
					].map((item) => (
						<Link
							onKeyDown={navigateOptions}
							key={item.href}
							href={item.href}
							prefetch={false}
							onClick={onClose}
						>
							{item.label}
						</Link>
					))}
					{search.trim() ? (
						<Link
							onKeyDown={navigateOptions}
							href={`/search?q=${encodeURIComponent(search.trim())}`}
							onClick={onClose}
						>
							Search resources for “{search.trim()}”
						</Link>
					) : null}
				</div>
			</div>
		</CreateModal>
	);
}
