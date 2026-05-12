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

import { KeyboardHelp } from "@/components/keyboard-help";
import { LogoutButton } from "@/components/logout-button";
import { ToastContainer } from "@/components/toast-container";
import { getApiErrorMessage } from "@/lib/api/errors";
import { getApiV1Classes } from "@/lib/api/generated/client";
import type { HubuumClassExpanded, HubuumObject } from "@/lib/api/generated/models";
import {
	fetchTasks,
	summarizeTaskActivity,
	type TaskActivitySummary,
} from "@/lib/api/tasking";
import {
	type CreateSection,
	DESELECT_ALL_EVENT,
	OPEN_CREATE_EVENT,
	SELECT_ALL_EVENT,
	SELECTION_STATE_EVENT,
	type SelectionStateEventDetail,
} from "@/lib/create-events";
import {
	triggerActivePaginationNextPage,
	triggerActivePaginationPrevPage,
} from "@/lib/pagination-shortcuts";
import { normalizeSearchTerm } from "@/lib/resource-search";

type AppShellProps = {
	canViewAdmin: boolean;
	children: ReactNode;
};

type ThemePreference = "system" | "light" | "dark";

type NavItem = {
	href: string;
	label: string;
	icon: ReactNode;
	hint: string;
};

const SIDEBAR_COLLAPSED_KEY = "hubuum.sidebar.collapsed";
const THEME_PREFERENCE_KEY = "hubuum.theme";

async function fetchTopbarClassOptions(): Promise<HubuumClassExpanded[]> {
	const response = await getApiV1Classes(
		{ limit: 250 },
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

async function fetchRecentTaskSummary(): Promise<TaskActivitySummary> {
	const page = await fetchTasks({
		limit: 50,
		sort: "created_at.desc,id.desc",
	});

	return summarizeTaskActivity(page.tasks);
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

function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference === "light" || preference === "dark") {
		return preference;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function isThemePreference(value: string | null): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
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
	if (pathname.startsWith("/search")) {
		return "Search";
	}
	if (pathname.startsWith("/reports")) {
		return "Reports";
	}
	if (pathname.startsWith("/imports")) {
		return "Imports";
	}
	if (pathname.startsWith("/statistics")) {
		return "Statistics";
	}
	if (pathname.startsWith("/namespaces")) {
		return "Namespaces";
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
	if (pathname.startsWith("/admin")) {
		return "Admin";
	}
	return "Home";
}

function getCreateSection(pathname: string): CreateSection | null {
	if (pathname === "/namespaces") {
		return "namespaces";
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

	return null;
}

function getCreateAriaLabel(
	createSection: CreateSection,
	relationsView: "classes" | "objects" | null,
	sectionLabel: string,
): string {
	if (createSection === "relations") {
		return `Add ${relationsView === "objects" ? "object relation" : "class relation"}`;
	}
	if (createSection === "admin-users") {
		return "Add user";
	}
	if (createSection === "admin-groups") {
		return "Add group";
	}
	if (createSection === "namespaces") {
		return "Add namespace";
	}
	if (createSection === "classes") {
		return "Add class";
	}
	if (createSection === "objects") {
		return "Add object";
	}

	return `Add ${sectionLabel}`;
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

const workspaceLinks: NavItem[] = [
	{
		href: "/app",
		label: "Home",
		icon: <IconHome />,
		hint: "Home: start from the task you want to complete",
	},
	{
		href: "/namespaces",
		label: "Namespaces",
		icon: <IconNamespace />,
		hint: "Namespaces: organize classes and permissions",
	},
	{
		href: "/classes",
		label: "Classes",
		icon: <IconClass />,
		hint: "Classes: define object schemas inside namespaces",
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
	{
		href: "/reports",
		label: "Reports",
		icon: <IconReport />,
		hint: "Reports: manage templates and render scoped output",
	},
	{
		href: "/imports",
		label: "Imports",
		icon: <IconImport />,
		hint: "Imports: submit JSON imports and monitor task execution",
	},
	{
		href: "/tasks",
		label: "Tasks",
		icon: <IconTasks />,
		hint: "Tasks: monitor active background work and resume task detail pages",
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
];

const systemLinks: NavItem[] = [
	{
		href: "/statistics",
		label: "Statistics",
		icon: <IconOverview />,
		hint: "Statistics: workspace counts and database status",
	},
];

export function AppShell({ canViewAdmin, children }: AppShellProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
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
	const taskSummaryQuery = useQuery({
		queryKey: ["tasks", "shell-summary"],
		queryFn: fetchRecentTaskSummary,
		refetchInterval: (query) => {
			const activeTasks = query.state.data?.activeTasks ?? 0;
			const isHidden =
				typeof document !== "undefined" &&
				document.visibilityState === "hidden";

			if (isHidden) {
				return activeTasks > 0 ? 15000 : 30000;
			}

			return activeTasks > 0 ? 5000 : 15000;
		},
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
	const [isUserMenuOpen, setUserMenuOpen] = useState(false);
	const [themePreference, setThemePreference] =
		useState<ThemePreference>("system");
	const [recentFailureUntil, setRecentFailureUntil] = useState<number | null>(
		null,
	);
	const [searchInput, setSearchInput] = useState("");
	const [selectionCount, setSelectionCount] = useState(0);
	const [deleteHandler, setDeleteHandler] = useState<(() => void) | null>(null);
	const [isKeyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
	const userMenuRef = useRef<HTMLDivElement | null>(null);
	const previousFailedTasksRef = useRef<number | null>(null);

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
	}, []);

	useEffect(() => {
		window.localStorage.setItem(
			SIDEBAR_COLLAPSED_KEY,
			isSidebarCollapsed ? "1" : "0",
		);
	}, [isSidebarCollapsed]);

	useEffect(() => {
		window.localStorage.setItem(THEME_PREFERENCE_KEY, themePreference);
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
		if (!pathname) {
			return;
		}

		setMobileSidebarOpen(false);
		setUserMenuOpen(false);
	}, [pathname]);

	useEffect(() => {
		setSearchInput(isSearchRoute ? (searchParams.get("q") ?? "") : "");
	}, [isSearchRoute, searchParams]);

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

		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setUserMenuOpen(false);
			}
		};

		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onEscape);
		};
	}, [isUserMenuOpen]);

	useEffect(() => {
		const failedTasks = taskSummaryQuery.data?.failedTasks ?? null;
		if (failedTasks === null) {
			return;
		}

		const previousFailedTasks = previousFailedTasksRef.current;
		previousFailedTasksRef.current = failedTasks;

		if (previousFailedTasks !== null && failedTasks > previousFailedTasks) {
			setRecentFailureUntil(Date.now() + 60_000);
		}
	}, [taskSummaryQuery.data?.failedTasks]);

	useEffect(() => {
		if (recentFailureUntil === null) {
			return;
		}

		const remainingMs = recentFailureUntil - Date.now();
		if (remainingMs <= 0) {
			setRecentFailureUntil(null);
			return;
		}

		const timeoutId = window.setTimeout(() => {
			setRecentFailureUntil(null);
		}, remainingMs);

		return () => window.clearTimeout(timeoutId);
	}, [recentFailureUntil]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const isTyping =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.contentEditable === "true" ||
				target.closest(".cm-editor") !== null;

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
				if (searchInput) {
					searchInput.focus();
					searchInput.select();
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
	}, [selectionCount, deleteHandler, openCreateModal]);

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

	const shellClassName = [
		"app-shell",
		isSidebarCollapsed ? "sidebar-collapsed" : "",
		isMobileSidebarOpen ? "mobile-sidebar-open" : "",
	]
		.filter(Boolean)
		.join(" ");
	const activeTaskCount = taskSummaryQuery.data?.activeTasks ?? 0;
	const hasRecentFailure =
		recentFailureUntil !== null && recentFailureUntil > Date.now();
	const taskBadgeLabel =
		activeTaskCount > 0
			? String(activeTaskCount)
			: hasRecentFailure
				? "!"
				: null;
	const taskBadgeTone = hasRecentFailure ? "danger" : "accent";

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

	function onObjectsClassChange(event: ChangeEvent<HTMLSelectElement>) {
		const nextClassId = event.target.value;
		const params = new URLSearchParams(searchParams.toString());

		if (nextClassId) {
			params.set("classId", nextClassId);
		} else {
			params.delete("classId");
		}

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

	return (
		<div className={shellClassName}>
			<div className="app-layout">
				<aside className="sidebar card" aria-label="Primary navigation">
					<div className="sidebar-main">
						<div className="sidebar-header">
							<div className="sidebar-brand">
								<p className="eyebrow sidebar-label">Hubuum</p>
								<h1 className="sidebar-title">Console</h1>
							</div>
						</div>

						<nav>
							<div className="sidebar-group">
								<p className="sidebar-label">Workspace</p>
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
								{workspaceLinks.map((item) => (
									<Link
										key={item.href}
										href={item.href}
										className={`sidebar-link ${isLinkActive(pathname, item.href) ? "active" : ""}`}
										aria-label={item.hint}
										data-tooltip={item.hint}
									>
										<span
											className={`sidebar-icon ${
												item.href === "/tasks" &&
												taskBadgeLabel &&
												isSidebarCollapsed
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
								))}
							</div>

							{canViewAdmin ? (
								<div className="sidebar-group">
									<p className="sidebar-label">Admin</p>
									{adminLinks.map((item) => (
										<Link
											key={item.href}
											href={item.href}
											className={`sidebar-link ${isLinkActive(pathname, item.href) ? "active" : ""}`}
											aria-label={item.hint}
											data-tooltip={item.hint}
										>
											<span className="sidebar-icon">{item.icon}</span>
											<span className="sidebar-text">{item.label}</span>
										</Link>
									))}
								</div>
							) : null}

							{canViewAdmin ? (
								<div className="sidebar-group">
									{!isSidebarCollapsed ? (
										<p className="sidebar-label">System</p>
									) : null}
									{systemLinks.map((item) => (
										<Link
											key={item.href}
											href={item.href}
											className={`sidebar-link ${isLinkActive(pathname, item.href) ? "active" : ""}`}
											aria-label={item.hint}
											data-tooltip={item.hint}
										>
											<span className="sidebar-icon">{item.icon}</span>
											<span className="sidebar-text">{item.label}</span>
										</Link>
									))}
								</div>
							) : null}

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
								<p className="topbar-heading">{sectionLabel}</p>
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
													{objectItem.name} (#{objectItem.id})
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
										className="ghost icon-button quick-add-button"
										onClick={openCreateModal}
										aria-label={getCreateAriaLabel(
											createSection,
											relationsView,
											sectionLabel,
										)}
									>
										<IconPlus />
									</button>
								) : null}
							</div>
						</div>

						<div className="topbar-right" ref={userMenuRef}>
							<form className="topbar-search-form" onSubmit={onSearchSubmit}>
								<div className="topbar-search-field">
									<input
										aria-label="Search namespaces, classes, and objects"
										className="topbar-search-input"
										value={searchInput}
										onChange={(event) => setSearchInput(event.target.value)}
										placeholder="Search namespaces, classes, and objects"
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
								className="ghost user-trigger"
								onClick={() => setUserMenuOpen((current) => !current)}
								aria-haspopup="menu"
								aria-expanded={isUserMenuOpen}
							>
								<span className="user-avatar">
									<IconUser />
								</span>
								<span className="user-trigger-text">Account</span>
								<span className="user-chevron">
									<IconChevron />
								</span>
							</button>

							{isUserMenuOpen ? (
								<div
									className="user-menu card"
									role="menu"
									aria-label="User menu"
								>
									<div className="menu-group">
										<p className="menu-label">Theme</p>
										<button
											type="button"
											className={`menu-item ${themePreference === "system" ? "is-selected" : ""}`}
											onClick={() => setThemePreference("system")}
										>
											System
										</button>
										<button
											type="button"
											className={`menu-item ${themePreference === "light" ? "is-selected" : ""}`}
											onClick={() => setThemePreference("light")}
										>
											Light
										</button>
										<button
											type="button"
											className={`menu-item ${themePreference === "dark" ? "is-selected" : ""}`}
											onClick={() => setThemePreference("dark")}
										>
											Dark
										</button>
									</div>

									<div className="menu-group">
										<LogoutButton className="menu-item menu-item-danger" />
									</div>
								</div>
							) : null}
						</div>
					</header>

					<main className="content">{children}</main>
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
					className="fab fab--delete"
					onClick={deleteHandler}
					aria-label={`Delete ${selectionCount} selected item${selectionCount === 1 ? "" : "s"}`}
					title={`Delete ${selectionCount} selected`}
				>
					<IconDelete />
					{selectionCount > 1 ? (
						<span className="fab-badge">{selectionCount}</span>
					) : null}
				</button>
			) : createSection ? (
				<button
					type="button"
					className="fab"
					onClick={openCreateModal}
					aria-label={getCreateAriaLabel(
						createSection,
						relationsView,
						sectionLabel,
					)}
					title={`${getCreateAriaLabel(createSection, relationsView, sectionLabel)} (C)`}
				>
					<IconPlus />
				</button>
			) : null}

			<KeyboardHelp
				open={isKeyboardHelpOpen}
				onClose={() => setKeyboardHelpOpen(false)}
			/>

			<ToastContainer />
		</div>
	);
}
