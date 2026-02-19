"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ChangeEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { LogoutButton } from "@/components/logout-button";
import { getApiV1Classes } from "@/lib/api/generated/client";
import type { HubuumClassExpanded } from "@/lib/api/generated/models";
import { getApiErrorMessage } from "@/lib/api/errors";
import { OPEN_CREATE_EVENT, type CreateSection } from "@/lib/create-events";

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

async function fetchObjectClassOptions(): Promise<HubuumClassExpanded[]> {
  const response = await getApiV1Classes({
    credentials: "include"
  });

  if (response.status !== 200) {
    throw new Error(getApiErrorMessage(response.data, "Failed to load classes."));
  }

  return response.data;
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") {
    return preference;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  return "Overview";
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

  return null;
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

function IconOverview() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13h7V4H4zm0 7h7v-5H4zm9 0h7V11h-7zm0-18v7h7V2z" fill="currentColor" />
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
      <path d="M3 7 12 2l9 5v10l-9 5-9-5zm9-3.3L6 7l6 3.3L18 7zm-7 5v7l6 3.3v-7z" fill="currentColor" />
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
      <path d="M15.4 7 14 8.4l3.6 3.6H6v2h11.6L14 17.6 15.4 19l6-6z" fill="currentColor" />
    </svg>
  );
}

function IconExpand() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.6 7 7.2 8.4 10.8 12H22v2H10.8l3.6 3.6L13 19l-6-6z" fill="currentColor" />
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

const workspaceLinks: NavItem[] = [
  {
    href: "/app",
    label: "Overview",
    icon: <IconOverview />,
    hint: "Overview: system counts and database status"
  },
  {
    href: "/namespaces",
    label: "Namespaces",
    icon: <IconNamespace />,
    hint: "Namespaces: organize classes and permissions"
  },
  {
    href: "/classes",
    label: "Classes",
    icon: <IconClass />,
    hint: "Classes: define object schemas inside namespaces"
  },
  {
    href: "/objects",
    label: "Objects",
    icon: <IconObject />,
    hint: "Objects: manage instances within classes"
  },
  {
    href: "/relations",
    label: "Relations",
    icon: <IconRelation />,
    hint: "Relations: connect classes and objects"
  }
];

const adminLinks: NavItem[] = [
  {
    href: "/admin/users",
    label: "Users",
    icon: <IconUser />,
    hint: "Users: inspect account access"
  },
  {
    href: "/admin/groups",
    label: "Groups",
    icon: <IconUsers />,
    hint: "Groups: manage role assignments"
  }
];

export function AppShell({ canViewAdmin, children }: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sectionLabel = useMemo(() => getSectionLabel(pathname), [pathname]);
  const createSection = useMemo(() => getCreateSection(pathname), [pathname]);
  const relationsView = useMemo(() => getRelationsView(pathname), [pathname]);
  const isObjectsListRoute = pathname === "/objects";
  const selectedObjectsClassId = searchParams.get("classId") ?? "";
  const objectsClassOptionsQuery = useQuery({
    queryKey: ["classes", "objects-topbar"],
    queryFn: fetchObjectClassOptions,
    enabled: isObjectsListRoute
  });
  const objectsClassOptions = objectsClassOptionsQuery.data ?? [];
  const resolvedObjectsClassId = useMemo(() => {
    return objectsClassOptions.some((classItem) => String(classItem.id) === selectedObjectsClassId)
      ? selectedObjectsClassId
      : "";
  }, [objectsClassOptions, selectedObjectsClassId]);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isUserMenuOpen, setUserMenuOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const userMenuRef = useRef<HTMLDivElement | null>(null);

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
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isSidebarCollapsed ? "1" : "0");
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
    if (!isUserMenuOpen) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || !userMenuRef.current || userMenuRef.current.contains(target)) {
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

  const shellClassName = [
    "app-shell",
    isSidebarCollapsed ? "sidebar-collapsed" : "",
    isMobileSidebarOpen ? "mobile-sidebar-open" : ""
  ]
    .filter(Boolean)
    .join(" ");

  function openCreateModal() {
    if (!createSection) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent(OPEN_CREATE_EVENT, {
        detail: {
          section: createSection
        }
      })
    );
  }

  function onRelationsViewChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextView = event.target.value === "objects" ? "objects" : "classes";
    router.push(`/relations/${nextView}`);
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

  return (
    <div className={shellClassName}>
      <div className="app-layout">
        <aside className="sidebar card" aria-label="Primary navigation">
          <div className="sidebar-main">
            <div className="sidebar-brand">
              <p className="eyebrow sidebar-label">Hubuum</p>
              <h1 className="sidebar-title">Console</h1>
            </div>

            <nav>
              <div className="sidebar-group">
                <p className="sidebar-label">Workspace</p>
                {workspaceLinks.map((item) => (
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
            </nav>
          </div>

          <div className="sidebar-footer">
            <LogoutButton className="ghost sidebar-signout" />
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

              <button
                type="button"
                className="ghost icon-button desktop-only"
                onClick={() => setSidebarCollapsed((current) => !current)}
                aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {isSidebarCollapsed ? <IconExpand /> : <IconCollapse />}
              </button>

              <div className="topbar-title-row">
                <p className="topbar-heading">{sectionLabel}</p>
                {relationsView ? (
                  <>
                    <span className="topbar-divider" aria-hidden="true">
                      /
                    </span>
                    <select
                      aria-label="Relations view"
                      className="topbar-inline-select"
                      value={relationsView}
                      onChange={onRelationsViewChange}
                    >
                      <option value="classes">Classes</option>
                      <option value="objects">Objects</option>
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
                        objectsClassOptionsQuery.isLoading ||
                        objectsClassOptionsQuery.isError ||
                        objectsClassOptions.length === 0
                      }
                    >
                      {objectsClassOptionsQuery.isLoading ? <option value="">Loading classes...</option> : null}
                      {objectsClassOptionsQuery.isError ? <option value="">Failed to load classes</option> : null}
                      {!objectsClassOptionsQuery.isLoading &&
                      !objectsClassOptionsQuery.isError &&
                      objectsClassOptions.length === 0 ? (
                        <option value="">No classes available</option>
                      ) : null}
                      {objectsClassOptions.map((hubuumClass) => (
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
                    aria-label={
                      relationsView
                        ? `Add ${relationsView === "classes" ? "class relation" : "object relation"}`
                        : `Add ${sectionLabel}`
                    }
                  >
                    <IconPlus />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="topbar-right" ref={userMenuRef}>
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
                <div className="user-menu card" role="menu" aria-label="User menu">
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
    </div>
  );
}
