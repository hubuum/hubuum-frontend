"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface ObjectDetailTrackerProps {
	objectId: number;
	objectName: string;
	classId: number;
	collectionId: number;
}

export function ObjectDetailTracker({
	objectId,
	objectName,
	classId,
	collectionId,
}: ObjectDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "object",
			id: objectId,
			name: objectName,
			classId,
			collectionId,
		});
	}, [objectId, objectName, classId, collectionId]);

	return null;
}
