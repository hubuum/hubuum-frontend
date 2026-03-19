"use client";

import { useEffect } from "react";

import { trackRecentItem } from "@/lib/recent-items";

interface NamespaceDetailTrackerProps {
	namespaceId: number;
	namespaceName: string;
}

export function NamespaceDetailTracker({
	namespaceId,
	namespaceName,
}: NamespaceDetailTrackerProps) {
	useEffect(() => {
		trackRecentItem({
			type: "namespace",
			id: namespaceId,
			name: namespaceName,
		});
	}, [namespaceId, namespaceName]);

	return null;
}
