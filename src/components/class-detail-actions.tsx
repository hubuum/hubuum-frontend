"use client";

import { useEffect, useState } from "react";

import { trackRecentItem } from "@/lib/recent-items";
import { isPinned, pinClass, unpinClass } from "@/lib/pinned-classes";

interface ClassDetailActionsProps {
	classId: number;
	className: string;
	namespaceName: string;
	namespaceId: number;
}

function IconPin() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z"
				fill="currentColor"
			/>
		</svg>
	);
}

export function ClassDetailActions({
	classId,
	className,
	namespaceName,
	namespaceId,
}: ClassDetailActionsProps) {
	const [pinned, setPinned] = useState(false);

	useEffect(() => {
		trackRecentItem({
			type: "class",
			id: classId,
			name: className,
			namespaceId,
		});

		setPinned(isPinned(classId));
	}, [classId, className, namespaceId]);

	function handleTogglePin() {
		if (pinned) {
			unpinClass(classId);
			setPinned(false);
		} else {
			const success = pinClass(classId, className, namespaceName);
			if (success) {
				setPinned(true);
			} else {
				alert("Maximum 5 classes can be pinned. Unpin one to add another.");
			}
		}
	}

	return (
		<button
			type="button"
			className={pinned ? "ghost" : ""}
			onClick={handleTogglePin}
			aria-label={pinned ? "Unpin this class" : "Pin this class"}
		>
			<IconPin />
			{pinned ? "Unpin" : "Pin class"}
		</button>
	);
}
