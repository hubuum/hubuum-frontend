"use client";

import type { TaskResponse } from "@/lib/api/generated/models";

export type RecentTaskEntry = {
  id: number;
  kind: TaskResponse["kind"];
  status: TaskResponse["status"];
  createdAt: string;
  summary: string | null;
  updatedAt: string;
};

type UpsertRecentTaskOptions = {
  onlyIfExists?: boolean;
};

const STORAGE_KEY = "hubuum.recent-tasks";
const STORAGE_EVENT = "hubuum:recent-tasks-changed";
const MAX_RECENT_TASKS = 20;

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isRecentTaskEntry(value: unknown): value is RecentTaskEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.kind === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    (typeof candidate.summary === "string" || candidate.summary === null)
  );
}

function dispatchRecentTasksChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function persistRecentTasks(entries: RecentTaskEntry[]): void {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  dispatchRecentTasksChanged();
}

export function loadRecentTasks(): RecentTaskEntry[] {
  if (!canUseStorage()) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isRecentTaskEntry).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
}

export function upsertRecentTask(task: TaskResponse, options?: UpsertRecentTaskOptions): RecentTaskEntry[] {
  const currentEntries = loadRecentTasks();
  const existingIndex = currentEntries.findIndex((entry) => entry.id === task.id);

  if (options?.onlyIfExists && existingIndex === -1) {
    return currentEntries;
  }

  const nextEntry: RecentTaskEntry = {
    id: task.id,
    kind: task.kind,
    status: task.status,
    createdAt: task.created_at,
    summary: task.summary ?? null,
    updatedAt: new Date().toISOString()
  };

  const nextEntries =
    existingIndex === -1
      ? [nextEntry, ...currentEntries]
      : [nextEntry, ...currentEntries.filter((entry) => entry.id !== task.id)];

  persistRecentTasks(nextEntries.slice(0, MAX_RECENT_TASKS));
  return nextEntries;
}

export function subscribeToRecentTasks(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) {
      return;
    }

    onChange();
  };

  window.addEventListener(STORAGE_EVENT, onChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(STORAGE_EVENT, onChange);
    window.removeEventListener("storage", handleStorage);
  };
}
