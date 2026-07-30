"use client";

import { useEffect, useState } from "react";
import {
	isPinned,
	MAX_PINNED_ITEMS,
	pinItem,
	unpinItem,
} from "@/lib/pinned-items";
import { useToast } from "@/lib/toast-context";
import type { PinnedItemType } from "@/types/quick-access";

interface PinButtonProps {
	type: PinnedItemType;
	id: number;
	name: string;
	collectionId?: number;
	collectionName?: string;
	classId?: number;
	className?: string;
}

function IconPin({ filled }: { filled: boolean }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" className="pin-icon">
			{filled ? (
				<path
					d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2z"
					fill="currentColor"
				/>
			) : (
				<path
					d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2zm-6 2H7.83L9 12.83V4h6v8.83L16.17 14z"
					fill="currentColor"
				/>
			)}
		</svg>
	);
}

export function PinButton({
	type,
	id,
	name,
	collectionId,
	collectionName,
	classId,
	className,
}: PinButtonProps) {
	const [classPinned, setClassPinned] = useState(false);
	const [collectionPinned, setCollectionPinned] = useState(false);
	const [objectPinned, setObjectPinned] = useState(false);
	const { showToast } = useToast();

	function showPinLimitToast() {
		showToast(
			`Maximum ${MAX_PINNED_ITEMS} items can be pinned. Unpin one to add another.`,
			"error",
		);
	}

	useEffect(() => {
		if (type === "class") {
			setClassPinned(isPinned("class", id));
		} else if (type === "collection") {
			setCollectionPinned(isPinned("collection", id));
		} else if (type === "object") {
			setObjectPinned(isPinned("object", id));
		}
	}, [type, id]);

	function handleCollectionToggle() {
		if (collectionPinned) {
			unpinItem("collection", id);
			setCollectionPinned(false);
		} else {
			const success = pinItem({
				type: "collection",
				id,
				name,
			});
			if (success) {
				setCollectionPinned(true);
			} else {
				showPinLimitToast();
			}
		}
	}

	function handleObjectToggle() {
		if (objectPinned) {
			unpinItem("object", id);
			setObjectPinned(false);
		} else {
			const success = pinItem({
				type: "object",
				id,
				name,
				collectionId,
				collectionName,
				classId,
				className,
			});
			if (success) {
				setObjectPinned(true);
			} else {
				showPinLimitToast();
			}
		}
	}

	function handleClassToggle() {
		if (classPinned) {
			unpinItem("class", id);
			setClassPinned(false);
		} else {
			const success = pinItem({
				type: "class",
				id,
				name,
				collectionId,
				collectionName,
			});
			if (success) {
				setClassPinned(true);
			} else {
				showPinLimitToast();
			}
		}
	}

	if (type === "collection") {
		return (
			<button
				type="button"
				className="pin-button-inline"
				onClick={handleCollectionToggle}
				aria-label={
					collectionPinned ? "Unpin this collection" : "Pin this collection"
				}
				title={collectionPinned ? "Unpin collection" : "Pin collection"}
			>
				<IconPin filled={collectionPinned} />
			</button>
		);
	}

	if (type === "object") {
		return (
			<button
				type="button"
				className="pin-button-inline"
				onClick={handleObjectToggle}
				aria-label={objectPinned ? "Unpin this object" : "Pin this object"}
				title={objectPinned ? "Unpin object" : "Pin object"}
			>
				<IconPin filled={objectPinned} />
			</button>
		);
	}

	return (
		<button
			type="button"
			className="pin-button-inline"
			onClick={handleClassToggle}
			aria-label={classPinned ? "Unpin this class" : "Pin this class"}
			title={classPinned ? "Unpin class" : "Pin class"}
		>
			<IconPin filled={classPinned} />
		</button>
	);
}
