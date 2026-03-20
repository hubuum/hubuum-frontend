"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface ObjectDetailTrackerProps {
	objectId: number;
	objectName: string;
	classId: number;
	namespaceId: number;
}

export function ObjectDetailTracker({
	objectId,
	objectName,
	classId,
	namespaceId,
}: ObjectDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "object",
			id: objectId,
			name: objectName,
			classId,
			namespaceId,
		});
	}, [objectId, objectName, classId, namespaceId]);

	return null;
}
