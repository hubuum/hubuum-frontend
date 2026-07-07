"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface CollectionDetailTrackerProps {
	collectionId: number;
	collectionName: string;
}

export function CollectionDetailTracker({
	collectionId,
	collectionName,
}: CollectionDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "collection",
			id: collectionId,
			name: collectionName,
		});
	}, [collectionId, collectionName]);

	return null;
}
