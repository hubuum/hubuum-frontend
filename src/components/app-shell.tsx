"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
	type ChangeEvent,
	type FormEvent,
	ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { BrandMark } from "@/components/brand-mark";
import { CreateModal } from "@/components/create-modal";
import { KeyboardHelp } from "@/components/keyboard-help";
import { LogoutButton } from "@/components/logout-button";
import { PinButton } from "@/components/pin-button";
import { ToastContainer } from "@/components/toast-container";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1Classes } from "@/lib/api/generated/client";
import type {
	HubuumClassExpanded,
	HubuumObject,
} from "@/lib/api/generated/models";
import {
	fetchTasks,
	isTerminalTaskStatus,
	type TaskRecord,
} from "@/lib/api/tasking";
import {
	type AccentPreference,
	type DensityPreference,
	isAccentPreference,
	isDensityPreference,
	isThemePreference,
	resolveTheme,
	type ThemePreference,
} from "@/lib/appearance-preferences";
import { APPLICATION_VERSION } from "@/lib/application-version";
import {
	type CreateSection,
	DESELECT_ALL_EVENT,
	EDIT_STATE_EVENT,
	type EditStateEventDetail,
	OPEN_CREATE_EVENT,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
	type SelectionStateEventDetail,
	TITLE_STATE_EVENT,
	type TitleStateEventDetail,
} from "@/lib/create-events";
import { OBJECT_SERVER_FILTERS_QUERY_KEY } from "@/lib/object-server-filters";
import {
	triggerActivePaginationNextPage,
	triggerActivePaginationPrevPage,
} from "@/lib/pagination-shortcuts";
import { normalizeSearchTerm } from "@/lib/resource-search";
import {
	countUnread,
	diffNewlyTerminal,
	filterMine,
	toastForTransition,
} from "@/lib/task-notifications";
import { useToast } from "@/lib/toast-context";
import {
	USER_SETTINGS_CHANGED_EVENT,
	writeDeviceSetting,
	writeUserSetting,
} from "@/lib/user-settings-client";
import {
	DEVICE_SETTING_KEYS,
	PORTABLE_USER_SETTING_KEYS,
} from "@/lib/user-settings-types";
import {
	hasActiveEscapeCancel,
	useEscapeToCancel,
} from "@/lib/use-escape-to-cancel";

type AppShellProps = {
	canViewAdmin: boolean;
	currentPrincipalId: number | null;
	currentUsername: string | null;
	children: ReactNode;
};

type NavItem = {
	href: string;
	label: string;
	icon: ReactNode;
	hint: string;
};

const SIDEBAR_COLLAPSED_KEY = DEVICE_SETTING_KEYS.sidebarCollapsed;
const THEME_PREFERENCE_KEY = PORTABLE_USER_SETTING_KEYS.theme;
const DENSITY_PREFERENCE_KEY = PORTABLE_USER_SETTING_KEYS.density;
const ACCENT_PREFERENCE_KEY = PORTABLE_USER_SETTING_KEYS.accent;
const SECONDARY_ACCENT_PREFERENCE_KEY =
	PORTABLE_USER_SETTING_KEYS.secondaryAccent;
const LOGIN_ACCENT_PREFERENCE_KEY = DEVICE_SETTING_KEYS.loginAccent;
const LOGIN_SECONDARY_ACCENT_PREFERENCE_KEY =
	DEVICE_SETTING_KEYS.loginSecondaryAccent;
const GO_TO_SHORTCUT_TIMEOUT_MS = 1500;
const GO_TO_ROUTES: Record<string, string> = {
	a: "/audit",
	h: "/app",
	n: "/collections",
	c: "/classes",
	o: "/objects",
	r: "/relations",
	e: "/exports",
	i: "/imports",
	t: "/tasks",
	s: "/statistics",
	u: "/admin/users",
	m: "/admin/groups",
};

async function fetchTopbarClassOptions(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250, include_total: false },
		{
			credentials: "include",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			getApiErrorMessage(response.data, "Failed to load classes."),
		);
	}

	return response.data;
}

async function parseJsonPayload(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) {
		return null;
	}

	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

async function fetchRelationsObjectOptions(
	classId: number,
): Promise<HubuumObject[]> {
	const response = await fetch(`/_hubuum-bff/classes/${classId}/objects`, {
		credentials: "include",
	});
	const payload = await parseJsonPayload(response);

	if (response.status !== 200) {
		throw new Error(getApiErrorMessage(payload, "Failed to load objects."));
	}

	if (!Array.isArray(payload)) {
		throw new Error("Unexpected objects payload.");
	}

	return payload as HubuumObject[];
}

function parseId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isLinkActive(pathname: string, href: string): boolean {
	if (href === "/app") {
		return pathname === "/app";
	}

	return pathname === href || pathname.startsWith(`${href}/`);
}

function getSectionLabel(pathname: string): string {
	if (pathname.startsWith("/tasks")) {
		return "Tasks";
	}
	if (pathname.startsWith("/audit")) {
		return "Audit";
	}
	if (pathname.startsWith("/search")) {
		return "Search";
	}
	if (pathname.startsWith("/exports")) {
		return "Exports";
	}
	if (pathname.startsWith("/imports")) {
		return "Imports";
	}
	if (pathname.startsWith("/statistics")) {
		return "Statistics";
	}
	if (pathname.startsWith("/account")) {
		return "Account";
	}
	if (pathname.startsWith("/collections")) {
		return "Collections";
	}
	if (pathname.startsWith("/classes")) {
		return "Classes";
	}
	if (pathname.startsWith("/objects")) {
		return "Objects";
	}
	if (pathname.startsWith("/relations")) {
		return "Relations";
	}
	if (pathname.startsWith("/admin/users")) {
		return "Users";
	}
	if (pathname.startsWith("/admin/groups")) {
		return "Groups";
	}
	if (pathname.startsWith("/admin/service-accounts")) {
		return "Service accounts";
	}
	if (pathname.startsWith("/admin/remote-targets")) {
		return "Remote targets";
	}
	if (pathname.startsWith("/admin/events")) {
		return "Events";
	}
	if (pathname.startsWith("/admin")) {
		return "Admin";
	}
	return "Home";
}

function getCreateSection(pathname: string): CreateSection | null {
	if (pathname === "/collections") {
		return "collections";
	}
	if (pathname === "/classes") {
		return "classes";
	}
	if (pathname === "/objects") {
		return "objects";
	}
	if (pathname.startsWith("/relations")) {
		return "relations";
	}
	if (pathname === "/admin/users") {
		return "admin-users";
	}
	if (pathname === "/admin/groups") {
		return "admin-groups";
	}
	if (pathname === "/admin/service-accounts") {
		return "admin-service-accounts";
	}
	if (pathname === "/admin/remote-targets") {
		return "admin-remote-targets";
	}

	return null;
}

function getCreateLabel(
	createSection: CreateSection,
	relationsView: "classes" | "objects" | null,
): string {
	if (createSection === "relations") {
		return `New ${relationsView === "objects" ? "object relation" : "class relation"}`;
	}
	if (createSection === "admin-users") {
		return "New user";
	}
	if (createSection === "admin-groups") {
		return "New group";
	}
	if (createSection === "admin-service-accounts") {
		return "New service account";
	}
	if (createSection === "admin-remote-targets") {
		return "New remote target";
	}
	if (createSection === "collections") {
		return "New collection";
	}
	if (createSection === "classes") {
		return "New class";
	}
	if (createSection === "objects") {
		return "New object";
	}

	return "New item";
}

function getRelationsView(pathname: string): "classes" | "objects" | null {
	if (pathname.startsWith("/relations/objects")) {
		return "objects";
	}
	if (pathname.startsWith("/relations")) {
		return "classes";
	}

	return null;
}

function IconHome() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 4.2 4 10.6V20h5.8v-5.2h4.4V20H20v-9.4zm8 7.1-8-6.4-8 6.4V8.8L12 2l8 6.8z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconOverview() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M4 13h7V4H4zm0 7h7v-5H4zm9 0h7V11h-7zm0-18v7h7V2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconReport() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M6 3h8.8L20 8.2V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m8 1.8V9h4.2M8 12h8v1.8H8zm0 4h8v1.8H8z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconImport() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3 6.7 8.3l1.3 1.4 3.1-3.1V16h2V6.6l3.1 3.1 1.4-1.4ZM5 18h14v3H5z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconCollection() {
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

function IconRelation() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M7 4a3 3 0 1 0 2.83 4H14v3.17A3 3 0 1 0 16 14h-4v-2h2.17A3 3 0 1 0 14 10h-4.17A3 3 0 0 0 7 4Z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconUser() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12m0 2.2c-4 0-7.5 2.1-7.5 4.8V21h15v-2c0-2.7-3.5-4.8-7.5-4.8"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconSystemTheme() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2m0 2v10h16V6z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconLightTheme() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M11 1h2v3h-2zm0 19h2v3h-2zM3.5 4.9l1.4-1.4L7 5.6 5.6 7zM17 18.4l1.4-1.4 2.1 2.1-1.4 1.4zM1 11h3v2H1zm19 0h3v2h-3zM3.5 19.1 5.6 17 7 18.4l-2.1 2.1zM17 5.6l2.1-2.1 1.4 1.4L18.4 7zM12 6a6 6 0 1 1 0 12 6 6 0 0 1 0-12m0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconDarkTheme() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M20.8 15.3A8.5 8.5 0 0 1 8.7 3.2 9 9 0 1 0 20.8 15.3M12 21a7 7 0 0 1-5.6-11.2 10.5 10.5 0 0 0 7.8 7.8A7 7 0 0 0 12 21"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconPalette() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3a9 9 0 0 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a1.5 1.5 0 0 1 0-3h3.8A5.2 5.2 0 0 0 21 7.8C21 5.1 16.8 3 12 3M7 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m2-5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5-1a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconArrowRight() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="m9 5 7 7-7 7-1.4-1.4 5.6-5.6-5.6-5.6z" fill="currentColor" />
		</svg>
	);
}

function IconUsers() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M16 11a3.5 3.5 0 1 0-2.9-5.5A4.5 4.5 0 0 1 12 14c3.1 0 5.6 1.5 6.6 3.6H22v-.9c0-2.2-2.6-4-6-4m-7-1a4 4 0 1 0-4-4 4 4 0 0 0 4 4m0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconRemoteTarget() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M5 4h8a4 4 0 0 1 3.9 3H19a3 3 0 0 1 0 6h-2.1A4 4 0 0 1 13 16H9v3h3v2H4v-2h3v-3H5a4 4 0 0 1 0-8h.1A4 4 0 0 1 5 7zm0 6a2 2 0 1 0 0 4h8a2 2 0 1 0 0-4zm12 1h2a1 1 0 1 0 0-2h-2zm-12-5a2 2 0 0 0-2 2.5A4 4 0 0 1 5 8h8a4 4 0 0 1 2 .54A2 2 0 0 0 13 6z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconMenu() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 7h16v2H4zm0 8h16v2H4zm0-4h16v2H4z" fill="currentColor" />
		</svg>
	);
}

function IconCollapse() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M15.4 7 14 8.4l3.6 3.6H6v2h11.6L14 17.6 15.4 19l6-6z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconExpand() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M8.6 7 7.2 8.4 10.8 12H22v2H10.8l3.6 3.6L13 19l-6-6z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconChevron() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="m7 10 5 5 5-5z" fill="currentColor" />
		</svg>
	);
}

function IconPlus() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M19 11H13V5h-2v6H5v2h6v6h2v-6h6z" fill="currentColor" />
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

function IconSearch() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M10.5 4a6.5 6.5 0 1 0 4.03 11.6l4.43 4.44 1.42-1.42-4.44-4.43A6.5 6.5 0 0 0 10.5 4m0 2a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconTasks() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M7 4a2 2 0 1 1-2 2 2 2 0 0 1 2-2m0 7a2 2 0 1 1-2 2 2 2 0 0 1 2-2m0 7a2 2 0 1 1-2 2 2 2 0 0 1 2-2m4-13h8v2h-8zm0 7h8v2h-8zm0 7h8v2h-8z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconAudit() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 2 4 5.2v6.6c0 5 3.4 8.4 8 10.2 4.6-1.8 8-5.2 8-10.2V5.2zm0 2.2 6 2.4v5.2c0 3.7-2.3 6.3-6 8-3.7-1.7-6-4.3-6-8V6.6zm-1 4.3h2v5.8h-2zm0 7.2h2v2h-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconDelete() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM8 9h8v10H8zm7.5-5-1-1h-5l-1 1H5v2h14V4z"
				fill="currentColor"
			/>
		</svg>
	);
}

function IconEdit() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="m4 16.8 8.9-8.9 3.2 3.2-8.9 8.9H4Zm10-10 1.8-1.8a1.8 1.8 0 0 1 2.5 0l.7.7a1.8 1.8 0 0 1 0 2.5l-1.8 1.8Z"
				fill="currentColor"
			/>
		</svg>
	);
}

const overviewLinks: NavItem[] = [
	{
		href: "/app",
		label: "Home",
		icon: <IconHome />,
		hint: "Home: start from the task you want to complete",
	},
];

const dataModelLinks: NavItem[] = [
	{
		href: "/collections",
		label: "Collections",
		icon: <IconCollection />,
		hint: "Collections: organize classes and permissions",
	},
	{
		href: "/classes",
		label: "Classes",
		icon: <IconClass />,
		hint: "Classes: define object schemas inside collections",
	},
	{
		href: "/objects",
		label: "Objects",
		icon: <IconObject />,
		hint: "Objects: manage instances within classes",
	},
	{
		href: "/relations",
		label: "Relations",
		icon: <IconRelation />,
		hint: "Relations: connect classes and objects",
	},
];

const workflowLinks: NavItem[] = [
	{
		href: "/imports",
		label: "Imports",
		icon: <IconImport />,
		hint: "Imports: submit JSON imports and monitor task execution",
	},
	{
		href: "/exports",
		label: "Exports",
		icon: <IconReport />,
		hint: "Exports: manage templates and render scoped output",
	},
	{
		href: "/tasks",
		label: "Tasks",
		icon: <IconTasks />,
		hint: "Tasks: monitor active background work and resume task detail pages",
	},
];

const observeLinks: NavItem[] = [
	{
		href: "/audit",
		label: "Audit",
		icon: <IconAudit />,
		hint: "Audit: inspect visible backend event history",
	},
];

const adminLinks: NavItem[] = [
	{
		href: "/admin/users",
		label: "Users",
		icon: <IconUser />,
		hint: "Users: inspect account access",
	},
	{
		href: "/admin/groups",
		label: "Groups",
		icon: <IconUsers />,
		hint: "Groups: manage role assignments",
	},
	{
		href: "/admin/service-accounts",
		label: "Service accounts",
		icon: <IconUser />,
		hint: "Service accounts: non-human principals for automation",
	},
	{
		href: "/admin/remote-targets",
		label: "Remote targets",
		icon: <IconRemoteTarget />,
		hint: "Remote targets: manage outbound actions",
	},
	{
		href: "/admin/events",
		label: "Events",
		icon: <IconAudit />,
		hint: "Events: inspect delivery health and retries",
	},
];

const systemLinks: NavItem[] = [
	{
		href: "/statistics",
		label: "Statistics",
		icon: <IconOverview />,
		hint: "Statistics: workspace counts and database status",
	},
];

export function AppShell({
	canViewAdmin,
	currentPrincipalId,
	currentUsername,
	children,
}: AppShellProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { showToast } = useToast();
	const currentUserId = currentPrincipalId;
	const prevMyTasksRef = useRef<TaskRecord[] | null>(null);
	const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);

	const myTasksQuery = useQuery({
		queryKey: ["tasks", "shell-mine", currentUserId],
		queryFn: async () => {
			if (currentUserId == null) {
				return { mine: [] as TaskRecord[], pageFull: false };
			}
			const page = await fetchTasks({
				submittedBy: currentUserId,
				limit: 50,
				sort: "created_at.desc,id.desc",
			});
			const mine = filterMine(page.tasks, currentUserId);
			return { mine, pageFull: page.tasks.length === 50 };
		},
		enabled: currentUserId != null,
		refetchInterval: (query) => {
			const mine = query.state.data?.mine ?? [];
			const hasActive = mine.some((task) => !isTerminalTaskStatus(task.status));
			const isHidden =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";

			if (isHidden) {
				return hasActive ? 15000 : 30000;
			}

			return hasActive ? 5000 : 15000;
		},
	});

	const sectionLabel = useMemo(() => getSectionLabel(pathname), [pathname]);
	const createSection = useMemo(() => getCreateSection(pathname), [pathname]);
	const relationsView = useMemo(() => getRelationsView(pathname), [pathname]);
	const isSearchRoute = pathname.startsWith("/search");
	const isRelationsRoute = relationsView !== null;
	const isObjectsListRoute = pathname === "/objects";
	const selectedRelationsClassId = searchParams.get("classId") ?? "";
	const selectedRelationsObjectId = searchParams.get("objectId") ?? "";
	const selectedObjectsClassId = searchParams.get("classId") ?? "";
	const topbarClassOptionsQuery = useQuery({
		queryKey: ["classes", "topbar-context"],
		queryFn: fetchTopbarClassOptions,
		enabled: isObjectsListRoute || isRelationsRoute,
	});
	const topbarClassOptions = topbarClassOptionsQuery.data ?? [];
	const resolvedObjectsClassId = useMemo(() => {
		return topbarClassOptions.some(
			(classItem) => String(classItem.id) === selectedObjectsClassId,
		)
			? selectedObjectsClassId
			: "";
	}, [selectedObjectsClassId, topbarClassOptions]);
	const resolvedRelationsClassId = useMemo(() => {
		return topbarClassOptions.some(
			(classItem) => String(classItem.id) === selectedRelationsClassId,
		)
			? selectedRelationsClassId
			: topbarClassOptions.length
				? String(topbarClassOptions[0].id)
				: "";
	}, [selectedRelationsClassId, topbarClassOptions]);
	const parsedResolvedRelationsClassId = useMemo(
		() => parseId(resolvedRelationsClassId),
		[resolvedRelationsClassId],
	);
	const relationsObjectOptionsQuery = useQuery({
		queryKey: ["objects", "relations-topbar", parsedResolvedRelationsClassId],
		queryFn: async () =>
			fetchRelationsObjectOptions(parsedResolvedRelationsClassId ?? 0),
		enabled: isRelationsRoute && parsedResolvedRelationsClassId !== null,
	});
	const relationsObjectOptions = relationsObjectOptionsQuery.data ?? [];
	const resolvedRelationsObjectId = useMemo(() => {
		return relationsObjectOptions.some(
			(objectItem) => String(objectItem.id) === selectedRelationsObjectId,
		)
			? selectedRelationsObjectId
			: "";
	}, [relationsObjectOptions, selectedRelationsObjectId]);
	const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
	const [isMobileSearchOpen, setMobileSearchOpen] = useState(false);
	const [isUserMenuOpen, setUserMenuOpen] = useState(false);
	const [isTaskMenuOpen, setTaskMenuOpen] = useState(false);
	const [themePreference, setThemePreference] =
		useState<ThemePreference>("system");
	const [densityPreference, setDensityPreference] =
		useState<DensityPreference>("comfortable");
	const [accentPreference, setAccentPreference] =
		useState<AccentPreference>("teal");
	const [secondaryAccentPreference, setSecondaryAccentPreference] =
		useState<AccentPreference>("teal");
	const [searchInput, setSearchInput] = useState("");
	const [selectionCount, setSelectionCount] = useState(0);
	const [deleteHandler, setDeleteHandler] = useState<(() => void) | null>(null);
	const [editLabel, setEditLabel] = useState("Edit item");
	const [editHandler, setEditHandler] = useState<(() => void) | null>(null);
	const [detailTitle, setDetailTitle] = useState<string | null>(null);
	const [detailPin, setDetailPin] =
		useState<TitleStateEventDetail["pin"]>(null);
	const [isKeyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
	const goToShortcutTimerRef = useRef<number | null>(null);
	const userMenuRef = useRef<HTMLDivElement | null>(null);
	const taskMenuRef = useRef<HTMLDivElement | null>(null);
	const didInitializeSidebarPreference = useRef(false);
	const didInitializeThemePreference = useRef(false);
	const didInitializeDensityPreference = useRef(false);
	const didInitializeAccentPreference = useRef(false);
	const didInitializeSecondaryAccentPreference = useRef(false);
	const hasCustomSecondaryAccent = useRef(false);

	const clearGoToShortcut = useCallback(() => {
		if (goToShortcutTimerRef.current === null) {
			return;
		}

		window.clearTimeout(goToShortcutTimerRef.current);
		goToShortcutTimerRef.current = null;
	}, []);

	const startGoToShortcut = useCallback(() => {
		clearGoToShortcut();
		goToShortcutTimerRef.current = window.setTimeout(() => {
			goToShortcutTimerRef.current = null;
		}, GO_TO_SHORTCUT_TIMEOUT_MS);
	}, [clearGoToShortcut]);

	const navigateGoToShortcut = useCallback(
		(key: string) => {
			const route = GO_TO_ROUTES[key.toLowerCase()];
			if (!route) {
				return false;
			}

			if (route.startsWith("/admin") && !canViewAdmin) {
				return false;
			}

			router.push(route);
			return true;
		},
		[canViewAdmin, router],
	);

	const openCreateModal = useCallback(() => {
		if (!createSection) {
			return;
		}

		window.dispatchEvent(
			new CustomEvent(OPEN_CREATE_EVENT, {
				detail: {
					section: createSection,
				},
			}),
		);
	}, [createSection]);

	useEffect(() => {
		const storedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
		if (storedCollapsed === "1") {
			setSidebarCollapsed(true);
		}

		const storedTheme = window.localStorage.getItem(THEME_PREFERENCE_KEY);
		if (isThemePreference(storedTheme)) {
			setThemePreference(storedTheme);
		}

		const storedDensity = window.localStorage.getItem(DENSITY_PREFERENCE_KEY);
		if (isDensityPreference(storedDensity)) {
			setDensityPreference(storedDensity);
		}

		const storedAccent = window.localStorage.getItem(ACCENT_PREFERENCE_KEY);
		const primaryAccent = isAccentPreference(storedAccent)
			? storedAccent
			: "teal";
		setAccentPreference(primaryAccent);

		const storedSecondaryAccent = window.localStorage.getItem(
			SECONDARY_ACCENT_PREFERENCE_KEY,
		);
		if (isAccentPreference(storedSecondaryAccent)) {
			hasCustomSecondaryAccent.current = true;
			setSecondaryAccentPreference(storedSecondaryAccent);
		} else {
			setSecondaryAccentPreference(primaryAccent);
		}
	}, []);

	useEffect(() => {
		const onSettingChange = (event: Event) => {
			const key = (event as CustomEvent<{ key?: string }>).detail?.key;
			if (key === THEME_PREFERENCE_KEY) {
				const value = window.localStorage.getItem(THEME_PREFERENCE_KEY);
				if (isThemePreference(value)) setThemePreference(value);
			}
			if (key === DENSITY_PREFERENCE_KEY) {
				const value = window.localStorage.getItem(DENSITY_PREFERENCE_KEY);
				if (isDensityPreference(value)) setDensityPreference(value);
			}
			if (key === ACCENT_PREFERENCE_KEY) {
				const value = window.localStorage.getItem(ACCENT_PREFERENCE_KEY);
				if (isAccentPreference(value)) setAccentPreference(value);
			}
			if (key === SECONDARY_ACCENT_PREFERENCE_KEY) {
				const value = window.localStorage.getItem(
					SECONDARY_ACCENT_PREFERENCE_KEY,
				);
				if (isAccentPreference(value)) {
					hasCustomSecondaryAccent.current = true;
					setSecondaryAccentPreference(value);
				}
			}
		};

		window.addEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingChange);
		return () =>
			window.removeEventListener(USER_SETTINGS_CHANGED_EVENT, onSettingChange);
	}, []);

	useEffect(() => {
		if (!didInitializeSidebarPreference.current) {
			didInitializeSidebarPreference.current = true;
			return;
		}
		writeDeviceSetting(SIDEBAR_COLLAPSED_KEY, isSidebarCollapsed ? "1" : "0");
	}, [isSidebarCollapsed]);

	useEffect(() => {
		return () => clearGoToShortcut();
	}, [clearGoToShortcut]);

	useEffect(() => {
		if (!didInitializeThemePreference.current) {
			didInitializeThemePreference.current = true;
		} else {
			writeUserSetting(THEME_PREFERENCE_KEY, themePreference);
		}
		const applyTheme = () => {
			const resolvedTheme = resolveTheme(themePreference);
			document.documentElement.setAttribute("data-theme", resolvedTheme);
			document.documentElement.style.colorScheme = resolvedTheme;
		};

		applyTheme();

		if (themePreference !== "system") {
			return;
		}

		const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			applyTheme();
		};

		if (typeof mediaQuery.addEventListener === "function") {
			mediaQuery.addEventListener("change", onChange);
			return () => mediaQuery.removeEventListener("change", onChange);
		}

		mediaQuery.addListener(onChange);
		return () => mediaQuery.removeListener(onChange);
	}, [themePreference]);

	useEffect(() => {
		if (!didInitializeDensityPreference.current) {
			didInitializeDensityPreference.current = true;
		} else {
			writeUserSetting(DENSITY_PREFERENCE_KEY, densityPreference);
		}
		document.documentElement.setAttribute("data-density", densityPreference);
	}, [densityPreference]);

	useEffect(() => {
		if (!didInitializeAccentPreference.current) {
			didInitializeAccentPreference.current = true;
			return;
		}
		writeUserSetting(ACCENT_PREFERENCE_KEY, accentPreference);
		writeDeviceSetting(LOGIN_ACCENT_PREFERENCE_KEY, accentPreference);
		document.documentElement.setAttribute("data-accent", accentPreference);
	}, [accentPreference]);

	useEffect(() => {
		if (!didInitializeSecondaryAccentPreference.current) {
			didInitializeSecondaryAccentPreference.current = true;
			return;
		}
		if (!hasCustomSecondaryAccent.current) {
			writeDeviceSetting(
				LOGIN_SECONDARY_ACCENT_PREFERENCE_KEY,
				secondaryAccentPreference,
			);
		}
		document.documentElement.setAttribute(
			"data-secondary-accent",
			secondaryAccentPreference,
		);
	}, [secondaryAccentPreference]);

	useEffect(() => {
		if (!pathname) {
			return;
		}

		setMobileSidebarOpen(false);
		setMobileSearchOpen(false);
		setUserMenuOpen(false);
		setTaskMenuOpen(false);
		setDetailTitle(null);
		setDetailPin(null);
	}, [pathname]);

	useEffect(() => {
		setSearchInput(isSearchRoute ? (searchParams.get("q") ?? "") : "");
	}, [isSearchRoute, searchParams]);

	useEscapeToCancel({
		enabled: isMobileSidebarOpen,
		onCancel: () => setMobileSidebarOpen(false),
	});
	useEscapeToCancel({
		enabled: isUserMenuOpen,
		onCancel: () => {
			setUserMenuOpen(false);
			window.setTimeout(
				() =>
					userMenuRef.current
						?.querySelector<HTMLButtonElement>(".user-trigger")
						?.focus(),
				0,
			);
		},
	});
	useEscapeToCancel({
		enabled: isTaskMenuOpen,
		onCancel: () => {
			setTaskMenuOpen(false);
			window.setTimeout(
				() =>
					taskMenuRef.current
						?.querySelector<HTMLButtonElement>(".task-menu-trigger")
						?.focus(),
				0,
			);
		},
	});

	useEffect(() => {
		if (!isUserMenuOpen) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (
				!target ||
				!userMenuRef.current ||
				userMenuRef.current.contains(target)
			) {
				return;
			}

			setUserMenuOpen(false);
		};

		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [isUserMenuOpen]);

	useEffect(() => {
		if (!isTaskMenuOpen) {
			return;
		}

		const onPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (
				!target ||
				!taskMenuRef.current ||
				taskMenuRef.current.contains(target)
			) {
				return;
			}

			setTaskMenuOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [isTaskMenuOpen]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const isTyping =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.contentEditable === "true" ||
				target.closest(".cm-editor") !== null;

			if (goToShortcutTimerRef.current !== null && event.key === "Escape") {
				event.preventDefault();
				clearGoToShortcut();
				return;
			}

			if (event.key === "Escape" && hasActiveEscapeCancel()) {
				return;
			}

			// Esc to deselect all (works anywhere)
			if (event.key === "Escape" && selectionCount > 0) {
				event.preventDefault();
				window.dispatchEvent(new CustomEvent(DESELECT_ALL_EVENT));
				return;
			}

			// Ctrl/Cmd+A to select all (works anywhere except when typing)
			if ((event.ctrlKey || event.metaKey) && event.key === "a" && !isTyping) {
				event.preventDefault();
				window.dispatchEvent(new CustomEvent(SELECT_ALL_EVENT));
				return;
			}

			// "/" to focus search (works anywhere except when typing)
			if (event.key === "/" && !isTyping) {
				event.preventDefault();
				const searchInput = document.querySelector(
					".topbar-search-input",
				) as HTMLInputElement;
				if (searchInput && searchInput.offsetParent !== null) {
					searchInput.focus();
					searchInput.select();
				} else {
					setMobileSearchOpen(true);
				}
				return;
			}

			// "?" to show keyboard help (works anywhere except when typing)
			if (event.key === "?" && !isTyping) {
				event.preventDefault();
				setKeyboardHelpOpen(true);
				return;
			}

			// Ignore other shortcuts if typing or if certain modifier keys are pressed
			if (isTyping || event.ctrlKey || event.metaKey || event.altKey) {
				return;
			}

			if (goToShortcutTimerRef.current !== null) {
				event.preventDefault();
				navigateGoToShortcut(event.key);
				clearGoToShortcut();
				return;
			}

			if (event.key === "g" || event.key === "G") {
				event.preventDefault();
				startGoToShortcut();
				return;
			}

			if (event.key === "n" || event.key === "N") {
				if (triggerActivePaginationNextPage()) {
					event.preventDefault();
				}
				return;
			}

			if (event.key === "p" || event.key === "P") {
				if (triggerActivePaginationPrevPage()) {
					event.preventDefault();
				}
				return;
			}

			// "C" to open create modal
			if (event.key === "c" || event.key === "C") {
				event.preventDefault();
				openCreateModal();
				return;
			}

			// "E" to edit the current item
			if ((event.key === "e" || event.key === "E") && editHandler) {
				event.preventDefault();
				editHandler();
				return;
			}

			// "D" to delete selected items
			if (
				(event.key === "d" || event.key === "D") &&
				selectionCount > 0 &&
				deleteHandler
			) {
				event.preventDefault();
				deleteHandler();
			}
		};

		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [
		selectionCount,
		deleteHandler,
		editHandler,
		openCreateModal,
		startGoToShortcut,
		navigateGoToShortcut,
		clearGoToShortcut,
	]);

	useEffect(() => {
		const onSelectionStateChange = (event: Event) => {
			const customEvent = event as CustomEvent<SelectionStateEventDetail>;
			const count = customEvent.detail?.count ?? 0;
			const handler = customEvent.detail?.deleteHandler;

			setSelectionCount(count);

			if (handler) {
				// To store a function in state, wrap it in another function
				setDeleteHandler(() => handler);
			} else {
				setDeleteHandler(null);
			}
		};

		window.addEventListener(SELECTION_STATE_EVENT, onSelectionStateChange);
		return () =>
			window.removeEventListener(SELECTION_STATE_EVENT, onSelectionStateChange);
	}, []);

	useEffect(() => {
		const onEditStateChange = (event: Event) => {
			const customEvent = event as CustomEvent<EditStateEventDetail>;
			const label = customEvent.detail?.label ?? "Edit item";
			const handler = customEvent.detail?.editHandler;

			setEditLabel(label);

			if (handler) {
				setEditHandler(() => handler);
			} else {
				setEditHandler(null);
			}
		};

		window.addEventListener(EDIT_STATE_EVENT, onEditStateChange);
		return () =>
			window.removeEventListener(EDIT_STATE_EVENT, onEditStateChange);
	}, []);

	useEffect(() => {
		const onTitleStateChange = (event: Event) => {
			const customEvent = event as CustomEvent<TitleStateEventDetail>;
			setDetailTitle(customEvent.detail?.title ?? null);
			setDetailPin(customEvent.detail?.pin ?? null);
		};

		window.addEventListener(TITLE_STATE_EVENT, onTitleStateChange);
		return () =>
			window.removeEventListener(TITLE_STATE_EVENT, onTitleStateChange);
	}, []);

	useEffect(() => {
		if (currentUserId == null) {
			return;
		}

		const key = DEVICE_SETTING_KEYS.tasksLastSeenAt(currentUserId);
		const stored = window.localStorage.getItem(key);
		if (stored == null) {
			const now = Date.now();
			writeDeviceSetting(key, String(now));
			setLastSeenAt(now);
			return;
		}

		const parsed = Number.parseInt(stored, 10);
		if (Number.isNaN(parsed)) {
			const now = Date.now();
			writeDeviceSetting(key, String(now));
			setLastSeenAt(now);
			return;
		}
		setLastSeenAt(parsed);
	}, [currentUserId]);

	useEffect(() => {
		if (currentUserId == null || !pathname.startsWith("/tasks")) {
			return;
		}

		const now = Date.now();
		writeDeviceSetting(
			DEVICE_SETTING_KEYS.tasksLastSeenAt(currentUserId),
			String(now),
		);
		setLastSeenAt(now);
	}, [pathname, currentUserId]);

	useEffect(() => {
		const data = myTasksQuery.data;
		if (!data) {
			return;
		}

		for (const task of diffNewlyTerminal(prevMyTasksRef.current, data.mine)) {
			const { message, type } = toastForTransition(task);
			showToast(message, type, { href: `/tasks/${task.id}` });
		}

		prevMyTasksRef.current = data.mine;
	}, [myTasksQuery.data, showToast]);

	const shellClassName = [
		"app-shell",
		isSidebarCollapsed ? "sidebar-collapsed" : "",
		isMobileSidebarOpen ? "mobile-sidebar-open" : "",
	]
		.filter(Boolean)
		.join(" ");
	const myTasks = myTasksQuery.data?.mine ?? [];
	const pageFull = myTasksQuery.data?.pageFull ?? false;
	const activeTaskCount = myTasks.filter(
		(task) => !isTerminalTaskStatus(task.status),
	).length;
	const unread =
		lastSeenAt == null
			? { unreadCount: 0, hasUnreadFailure: false, isSaturated: false }
			: countUnread(myTasks, lastSeenAt, pageFull);

	let taskBadgeLabel: string | null = null;
	let taskBadgeTone: "accent" | "danger" = "accent";
	if (unread.unreadCount > 0) {
		taskBadgeLabel = unread.isSaturated
			? `${unread.unreadCount}+`
			: String(unread.unreadCount);
		taskBadgeTone = unread.hasUnreadFailure ? "danger" : "accent";
	} else if (activeTaskCount > 0) {
		taskBadgeLabel = String(activeTaskCount);
		taskBadgeTone = "accent";
	}

	function renderTaskBadge() {
		if (!taskBadgeLabel) {
			return null;
		}

		return (
			<span
				className={`sidebar-badge sidebar-badge--${taskBadgeTone}`}
				aria-hidden="true"
			>
				{taskBadgeLabel}
			</span>
		);
	}

	const taskMenuItems = [...myTasks]
		.sort((left, right) => {
			const leftActive = isTerminalTaskStatus(left.status) ? 1 : 0;
			const rightActive = isTerminalTaskStatus(right.status) ? 1 : 0;
			if (leftActive !== rightActive) {
				return leftActive - rightActive;
			}

			return (
				new Date(right.created_at).getTime() -
				new Date(left.created_at).getTime()
			);
		})
		.slice(0, 6);

	function onObjectsClassChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextClassId = event.target.value;
		const params = new URLSearchParams(searchParams.toString());

		if (nextClassId) {
			params.set("classId", nextClassId);
		} else {
			params.delete("classId");
		}
		params.delete("cursor");
		params.delete("search");
		params.delete(OBJECT_SERVER_FILTERS_QUERY_KEY);

		const query = params.toString();
		router.push(query ? `/objects?${query}` : "/objects");
	}

	function onRelationsClassChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextClassId = event.target.value;
		const params = new URLSearchParams(searchParams.toString());

		if (nextClassId) {
			params.set("classId", nextClassId);
		} else {
			params.delete("classId");
		}

		params.delete("objectId");
		params.delete("objectView");

		const query = params.toString();
		router.push(query ? `/relations/classes?${query}` : "/relations/classes");
	}

	function onRelationsObjectChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextObjectId = event.target.value;
		const params = new URLSearchParams(searchParams.toString());

		if (resolvedRelationsClassId) {
			params.set("classId", resolvedRelationsClassId);
		} else {
			params.delete("classId");
		}

		if (nextObjectId) {
			params.set("objectId", nextObjectId);
			const query = params.toString();
			router.push(query ? `/relations/objects?${query}` : "/relations/objects");
			return;
		}

		params.delete("objectId");
		params.delete("objectView");
		const query = params.toString();
		router.push(query ? `/relations/classes?${query}` : "/relations/classes");
	}

	function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setMobileSearchOpen(false);

		const trimmedSearchTerm = normalizeSearchTerm(searchInput);
		const params = isSearchRoute
			? new URLSearchParams(searchParams.toString())
			: new URLSearchParams();

		if (trimmedSearchTerm) {
			params.set("q", trimmedSearchTerm);
		} else {
			params.delete("q");
		}

		const query = params.toString();
		router.push(query ? `/search?${query}` : "/search");
	}

	function clearSearch() {
		setSearchInput("");
		if (!isSearchRoute) {
			return;
		}

		const params = new URLSearchParams(searchParams.toString());
		params.delete("q");

		const query = params.toString();
		router.push(query ? `/search?${query}` : "/search");
	}

	function renderNavigationLinks(items: NavItem[]) {
		return items.map((item) => {
			const isActive = isLinkActive(pathname, item.href);

			return (
				<Link
					key={item.href}
					href={item.href}
					className={`sidebar-link ${isActive ? "active" : ""}`}
					aria-label={item.hint}
					aria-current={isActive ? "page" : undefined}
					data-tooltip={item.hint}
				>
					<span
						className={`sidebar-icon ${
							item.href === "/tasks" && taskBadgeLabel && isSidebarCollapsed
								? "sidebar-icon--badged"
								: ""
						}`}
					>
						{item.icon}
						{item.href === "/tasks" && isSidebarCollapsed
							? renderTaskBadge()
							: null}
					</span>
					<span className="sidebar-text">{item.label}</span>
					{item.href === "/tasks" && !isSidebarCollapsed
						? renderTaskBadge()
						: null}
				</Link>
			);
		});
	}

	return (
		<div className={shellClassName}>
			<a className="skip-link" href="#main-content">
				Skip to content
			</a>
			<div className="app-layout">
				<aside className="sidebar card" aria-label="Primary navigation">
					<div className="sidebar-main">
						<div className="sidebar-header">
							<BrandMark href="/app" />
						</div>

						<nav>
							<div className="sidebar-group">
								<p className="sidebar-label">Overview</p>
								{isSidebarCollapsed ? (
									<button
										type="button"
										className="sidebar-link sidebar-link-button desktop-only"
										onClick={() => setSidebarCollapsed(false)}
										aria-label="Expand sidebar"
										data-tooltip="Expand sidebar"
									>
										<span className="sidebar-icon">
											<IconCollapse />
										</span>
										<span className="sidebar-text">Expand sidebar</span>
									</button>
								) : null}
								{renderNavigationLinks(overviewLinks)}
							</div>

							<div className="sidebar-group">
								<p className="sidebar-label">Data model</p>
								{renderNavigationLinks(dataModelLinks)}
							</div>

							<div className="sidebar-group">
								<p className="sidebar-label">Workflows</p>
								{renderNavigationLinks(workflowLinks)}
							</div>

							{canViewAdmin ? (
								<div className="sidebar-group">
									<p className="sidebar-label">Administration</p>
									{renderNavigationLinks(adminLinks)}
								</div>
							) : null}

							<div className="sidebar-group">
								<p className="sidebar-label">Observe</p>
								{renderNavigationLinks([
									...observeLinks,
									...(canViewAdmin ? systemLinks : []),
								])}
							</div>

							{!isSidebarCollapsed ? (
								<div className="sidebar-group desktop-only">
									<button
										type="button"
										className="sidebar-link sidebar-link-button"
										onClick={() => setSidebarCollapsed(true)}
										aria-label="Collapse sidebar"
									>
										<span className="sidebar-icon">
											<IconExpand />
										</span>
										<span className="sidebar-text">Collapse sidebar</span>
									</button>
								</div>
							) : null}
						</nav>
					</div>
					<p
						className="sidebar-footer"
						title={`Hubuum Frontend ${APPLICATION_VERSION}`}
					>
						{APPLICATION_VERSION}
					</p>
				</aside>

				<div className="app-main">
					<header className="topbar card">
						<div className="topbar-left">
							<button
								type="button"
								className="ghost icon-button mobile-only"
								onClick={() => setMobileSidebarOpen(true)}
								aria-label="Open navigation"
							>
								<IconMenu />
							</button>

							<div className="topbar-title-row">
								<div className="topbar-title-stack">
									<span className="topbar-caption">
										{pathname.startsWith("/admin")
											? "Administration"
											: "Workspace"}
									</span>
									<h1 className="topbar-heading">
										{detailTitle ?? sectionLabel}
									</h1>
								</div>
								{detailPin ? (
									<PinButton
										type={detailPin.type}
										id={detailPin.id}
										name={detailPin.name}
										collectionId={
											"collectionId" in detailPin
												? detailPin.collectionId
												: undefined
										}
										collectionName={
											"collectionName" in detailPin
												? detailPin.collectionName
												: undefined
										}
										classId={
											"classId" in detailPin ? detailPin.classId : undefined
										}
										className={
											"className" in detailPin ? detailPin.className : undefined
										}
									/>
								) : null}
								{isRelationsRoute ? (
									<>
										<span className="topbar-divider" aria-hidden="true">
											/
										</span>
										<select
											aria-label="Relations class context"
											className="topbar-inline-select"
											value={resolvedRelationsClassId}
											onChange={onRelationsClassChange}
											disabled={
												topbarClassOptionsQuery.isLoading ||
												topbarClassOptionsQuery.isError ||
												topbarClassOptions.length === 0
											}
										>
											{topbarClassOptionsQuery.isLoading ? (
												<option value="">Loading classes...</option>
											) : null}
											{topbarClassOptionsQuery.isError ? (
												<option value="">Failed to load classes</option>
											) : null}
											{!topbarClassOptionsQuery.isLoading &&
											!topbarClassOptionsQuery.isError &&
											topbarClassOptions.length === 0 ? (
												<option value="">No classes available</option>
											) : null}
											{topbarClassOptions.map((hubuumClass) => (
												<option key={hubuumClass.id} value={hubuumClass.id}>
													{hubuumClass.name}
												</option>
											))}
										</select>
										<span className="topbar-divider" aria-hidden="true">
											/
										</span>
										<select
											aria-label="Relations object context"
											className="topbar-inline-select"
											value={resolvedRelationsObjectId}
											onChange={onRelationsObjectChange}
											disabled={
												!resolvedRelationsClassId ||
												relationsObjectOptionsQuery.isLoading ||
												relationsObjectOptionsQuery.isError
											}
										>
											<option value=""></option>
											{relationsObjectOptionsQuery.isLoading ? (
												<option value="" disabled>
													Loading objects...
												</option>
											) : null}
											{relationsObjectOptionsQuery.isError ? (
												<option value="" disabled>
													Failed to load objects
												</option>
											) : null}
											{!relationsObjectOptionsQuery.isLoading &&
											!relationsObjectOptionsQuery.isError &&
											relationsObjectOptions.length === 0 ? (
												<option value="" disabled>
													No objects available
												</option>
											) : null}
											{relationsObjectOptions.map((objectItem) => (
												<option key={objectItem.id} value={objectItem.id}>
													{objectItem.name}
												</option>
											))}
										</select>
									</>
								) : null}
								{isObjectsListRoute ? (
									<>
										<span className="topbar-context-label">of</span>
										<select
											aria-label="Objects class context"
											className="topbar-inline-select"
											value={resolvedObjectsClassId}
											onChange={onObjectsClassChange}
											disabled={
												topbarClassOptionsQuery.isLoading ||
												topbarClassOptionsQuery.isError ||
												topbarClassOptions.length === 0
											}
										>
											{topbarClassOptionsQuery.isLoading ? (
												<option value="">Loading classes...</option>
											) : null}
											{topbarClassOptionsQuery.isError ? (
												<option value="">Failed to load classes</option>
											) : null}
											{!topbarClassOptionsQuery.isLoading &&
											!topbarClassOptionsQuery.isError &&
											topbarClassOptions.length === 0 ? (
												<option value="">No classes available</option>
											) : null}
											{topbarClassOptions.map((hubuumClass) => (
												<option key={hubuumClass.id} value={hubuumClass.id}>
													{hubuumClass.name}
												</option>
											))}
										</select>
									</>
								) : null}
								{createSection ? (
									<button
										type="button"
										className="create-button"
										onClick={openCreateModal}
										aria-label={getCreateLabel(createSection, relationsView)}
										title={getCreateLabel(createSection, relationsView)}
									>
										<IconPlus />
										<span className="create-button-text">
											{getCreateLabel(createSection, relationsView)}
										</span>
									</button>
								) : null}
							</div>
						</div>

						<div className="topbar-right" ref={userMenuRef}>
							<form
								className="topbar-search-form desktop-search-form"
								onSubmit={onSearchSubmit}
							>
								<div className="topbar-search-field">
									<input
										aria-label="Search collections, classes, and objects"
										className="topbar-search-input"
										value={searchInput}
										onChange={(event) => setSearchInput(event.target.value)}
										placeholder="Search collections, classes, and objects"
									/>
									{normalizeSearchTerm(searchInput) ? (
										<button
											type="button"
											className="ghost topbar-search-clear"
											onClick={clearSearch}
											aria-label="Clear search"
										>
											<IconClose />
										</button>
									) : null}
								</div>
								<button
									type="submit"
									className="ghost icon-button topbar-search-submit"
									aria-label="Open search"
								>
									<IconSearch />
								</button>
							</form>

							<button
								type="button"
								className="ghost icon-button mobile-only mobile-search-trigger"
								onClick={() => setMobileSearchOpen(true)}
								aria-label="Search workspace"
								title="Search workspace"
							>
								<IconSearch />
							</button>

							<div className="task-menu-wrapper" ref={taskMenuRef}>
								<button
									type="button"
									className="ghost icon-button task-menu-trigger"
									onClick={() => setTaskMenuOpen((current) => !current)}
									aria-controls="task-activity-popover"
									aria-expanded={isTaskMenuOpen}
									aria-label="Task activity"
									title="Task activity"
								>
									<IconTasks />
									{renderTaskBadge()}
								</button>

								{isTaskMenuOpen ? (
									<section
										id="task-activity-popover"
										className="task-menu card"
										aria-label="Task activity"
									>
										<div className="task-menu-header">
											<div>
												<p className="menu-label">Task Activity</p>
												<p className="muted">
													{activeTaskCount > 0
														? `${activeTaskCount} active`
														: "No active tasks"}
												</p>
											</div>
											<Link
												className="link-chip"
												href="/tasks"
												onClick={() => setTaskMenuOpen(false)}
											>
												Open tasks
											</Link>
										</div>

										{myTasksQuery.isLoading ? (
											<div className="muted">Loading tasks...</div>
										) : null}
										{myTasksQuery.isError ? (
											<div className="error-banner">
												Failed to load task activity.
											</div>
										) : null}
										{!myTasksQuery.isLoading &&
										!myTasksQuery.isError &&
										taskMenuItems.length === 0 ? (
											<div className="muted">No recent task activity.</div>
										) : null}
										{taskMenuItems.length > 0 ? (
											<div className="task-menu-list">
												{taskMenuItems.map((task) => (
													<Link
														key={task.id}
														className="task-menu-item"
														href={`/tasks/${task.id}`}
														onClick={() => setTaskMenuOpen(false)}
													>
														<span
															className={`status-pill status-pill--${isTerminalTaskStatus(task.status) ? "neutral" : "accent"}`}
														>
															{task.status}
														</span>
														<span>
															<strong>
																{task.kind} #{task.id}
															</strong>
															<span className="muted">
																{new Date(task.created_at).toLocaleString()}
															</span>
														</span>
													</Link>
												))}
											</div>
										) : null}
									</section>
								) : null}
							</div>

							<button
								type="button"
								className="ghost user-trigger"
								onClick={() => setUserMenuOpen((current) => !current)}
								aria-controls="account-popover"
								aria-expanded={isUserMenuOpen}
								aria-label={`Open account menu for ${currentUsername ?? "current user"}`}
							>
								<span className="user-avatar">
									<IconUser />
								</span>
								<span className="user-trigger-text">
									{currentUsername ?? "Account"}
								</span>
								<span className="user-chevron">
									<IconChevron />
								</span>
							</button>

							{isUserMenuOpen ? (
								<section
									id="account-popover"
									className="user-menu card"
									aria-label="User menu"
								>
									<div className="account-menu-header">
										<span className="user-avatar account-menu-avatar">
											<IconUser />
										</span>
										<span className="account-menu-identity">
											<strong>{currentUsername ?? "Account"}</strong>
											<small>Workspace account</small>
										</span>
									</div>

									<div className="menu-group menu-theme-group">
										<fieldset className="quick-theme-picker">
											<legend className="menu-label">Theme</legend>
											<div className="quick-theme-options">
												<button
													type="button"
													className={`quick-theme-option ${themePreference === "system" ? "is-selected" : ""}`}
													onClick={() => setThemePreference("system")}
													aria-pressed={themePreference === "system"}
												>
													<IconSystemTheme />
													<span>System</span>
												</button>
												<button
													type="button"
													className={`quick-theme-option ${themePreference === "light" ? "is-selected" : ""}`}
													onClick={() => setThemePreference("light")}
													aria-pressed={themePreference === "light"}
												>
													<IconLightTheme />
													<span>Light</span>
												</button>
												<button
													type="button"
													className={`quick-theme-option ${themePreference === "dark" ? "is-selected" : ""}`}
													onClick={() => setThemePreference("dark")}
													aria-pressed={themePreference === "dark"}
												>
													<IconDarkTheme />
													<span>Dark</span>
												</button>
											</div>
										</fieldset>
									</div>

									<div className="menu-group menu-navigation-group">
										<Link
											className="menu-item menu-nav-item"
											href="/account/appearance"
											onClick={() => setUserMenuOpen(false)}
										>
											<span className="menu-nav-icon">
												<IconPalette />
											</span>
											<span className="menu-nav-copy">
												<strong>Appearance</strong>
												<small>Theme, color and density</small>
											</span>
											<span className="menu-nav-arrow">
												<IconArrowRight />
											</span>
										</Link>
										<Link
											className="menu-item menu-nav-item"
											href="/account"
											onClick={() => setUserMenuOpen(false)}
										>
											<span className="menu-nav-icon">
												<IconUser />
											</span>
											<span className="menu-nav-copy">
												<strong>Account</strong>
												<small>Profile, tokens and access</small>
											</span>
											<span className="menu-nav-arrow">
												<IconArrowRight />
											</span>
										</Link>
									</div>

									<div className="menu-group menu-signout-group">
										<LogoutButton className="menu-item menu-item-danger account-menu-signout" />
									</div>
								</section>
							) : null}
						</div>
					</header>

					<main className="content" id="main-content">
						{children}
					</main>
				</div>
			</div>

			{isMobileSidebarOpen ? (
				<button
					type="button"
					aria-label="Close navigation"
					className="sidebar-backdrop"
					onClick={() => setMobileSidebarOpen(false)}
				/>
			) : null}

			{selectionCount > 0 && deleteHandler ? (
				<button
					type="button"
					className="fab fab--extended fab--delete"
					onClick={deleteHandler}
					aria-label={`Delete ${selectionCount} selected item${selectionCount === 1 ? "" : "s"}`}
					title={`Delete ${selectionCount} selected`}
				>
					<IconDelete />
					<span className="fab-text">Delete {selectionCount} selected</span>
					{selectionCount > 1 ? (
						<span className="fab-badge">{selectionCount}</span>
					) : null}
				</button>
			) : editHandler ? (
				<button
					type="button"
					className="fab fab--extended"
					onClick={editHandler}
					aria-label={editLabel}
					title={`${editLabel} (E)`}
				>
					<IconEdit />
					<span className="fab-text">{editLabel}</span>
				</button>
			) : createSection ? (
				<button
					type="button"
					className="fab fab--extended fab--create"
					onClick={openCreateModal}
					aria-label={getCreateLabel(createSection, relationsView)}
					title={`${getCreateLabel(createSection, relationsView)} (C)`}
				>
					<IconPlus />
					<span className="fab-text">
						{getCreateLabel(createSection, relationsView)}
					</span>
				</button>
			) : null}

			<CreateModal
				open={isMobileSearchOpen}
				title="Search workspace"
				onClose={() => setMobileSearchOpen(false)}
			>
				<form className="stack mobile-search-form" onSubmit={onSearchSubmit}>
					<label className="control-field" htmlFor="mobile-workspace-search">
						<span>Collections, classes, and objects</span>
						<input
							id="mobile-workspace-search"
							value={searchInput}
							onChange={(event) => setSearchInput(event.target.value)}
							placeholder="Search the workspace"
							autoComplete="off"
						/>
					</label>
					<div className="form-actions form-actions--end">
						<button
							type="button"
							className="ghost"
							onClick={() => setMobileSearchOpen(false)}
						>
							Cancel
						</button>
						<button type="submit">Search</button>
					</div>
				</form>
			</CreateModal>

			<KeyboardHelp
				open={isKeyboardHelpOpen}
				onClose={() => setKeyboardHelpOpen(false)}
			/>

			<ToastContainer />
		</div>
	);
}
