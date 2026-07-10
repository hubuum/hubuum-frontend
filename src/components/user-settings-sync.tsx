"use client";

import { useQuery } from "@tanstack/react-query";
import {
	Fragment,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import {
	flushUserSettings,
	getUserSettingsSyncStatus,
	initializeUserSettings,
	markUserSettingsSyncDegraded,
	prepareUserSettingsCache,
	USER_SETTINGS_QUERY_KEY,
	USER_SETTINGS_SYNC_STATUS_EVENT,
	type UserSettingsSyncStatus,
} from "@/lib/user-settings-client";
import { loadUserSettingsSnapshot } from "@/lib/user-settings-transport";
import type { UserSettingsSnapshot } from "@/lib/user-settings-types";

type UserSettingsSyncProps = {
	children: ReactNode;
	principalId: number | null;
	initialSnapshot: UserSettingsSnapshot | null;
};

export function UserSettingsSync({
	children,
	principalId,
	initialSnapshot,
}: UserSettingsSyncProps) {
	const initializedSnapshot = useRef<UserSettingsSnapshot | null>(null);
	const [cacheRevision, setCacheRevision] = useState(() => {
		if (typeof window !== "undefined") {
			if (initialSnapshot) initializeUserSettings(initialSnapshot);
			else prepareUserSettingsCache(principalId);
		}
		return 0;
	});
	const [syncStatus, setSyncStatus] = useState<UserSettingsSyncStatus>(() =>
		typeof window === "undefined"
			? initialSnapshot
				? "synced"
				: "idle"
			: getUserSettingsSyncStatus(),
	);
	const settingsQuery = useQuery({
		queryKey: USER_SETTINGS_QUERY_KEY,
		queryFn: loadUserSettingsSnapshot,
		initialData: initialSnapshot ?? undefined,
		staleTime: Number.POSITIVE_INFINITY,
		retry: 2,
		refetchInterval: (query) =>
			query.state.status === "error" ? 30_000 : false,
	});

	useLayoutEffect(() => {
		if (
			settingsQuery.data &&
			initializedSnapshot.current !== settingsQuery.data
		) {
			initializeUserSettings(settingsQuery.data);
			initializedSnapshot.current = settingsQuery.data;
			setSyncStatus(getUserSettingsSyncStatus());
			setCacheRevision((current) => current + 1);
		} else if (settingsQuery.isError) {
			prepareUserSettingsCache(principalId);
			markUserSettingsSyncDegraded();
			setSyncStatus("degraded");
		}
	}, [principalId, settingsQuery.data, settingsQuery.isError]);

	useEffect(() => {
		const onStatusChange = (event: Event) => {
			const status = (event as CustomEvent<{ status?: UserSettingsSyncStatus }>)
				.detail?.status;
			if (status) setSyncStatus(status);
		};
		window.addEventListener(USER_SETTINGS_SYNC_STATUS_EVENT, onStatusChange);
		return () =>
			window.removeEventListener(
				USER_SETTINGS_SYNC_STATUS_EVENT,
				onStatusChange,
			);
	}, []);

	useEffect(() => {
		const flush = () => void flushUserSettings({ keepalive: true });
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("pagehide", flush);
			void flushUserSettings({ keepalive: true });
		};
	}, []);

	return (
		<>
			{syncStatus === "degraded" ? (
				<div className="settings-sync-warning" role="status">
					Preferences are saved on this device. Account sync will retry when the
					service is available.
				</div>
			) : null}
			<Fragment key={cacheRevision}>{children}</Fragment>
		</>
	);
}
