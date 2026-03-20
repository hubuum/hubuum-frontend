"use client";

import { useEffect, useState } from "react";
import { PinMenu } from "@/components/pin-menu";
import { isPinned, pinItem, unpinItem } from "@/lib/pinned-items";
import type { PinnedItemType } from "@/types/quick-access";

interface PinButtonProps {
	type: PinnedItemType;
	id: number;
	name: string;
	namespaceId?: number;
	namespaceName?: string;
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
	namespaceId,
	namespaceName,
	classId,
	className,
}: PinButtonProps) {
	const [viewPinned, setViewPinned] = useState(false);
	const [createPinned, setCreatePinned] = useState(false);
	const [namespacePinned, setNamespacePinned] = useState(false);
	const [objectPinned, setObjectPinned] = useState(false);
	const [isMenuOpen, setMenuOpen] = useState(false);

	useEffect(() => {
		if (type === "class") {
			setViewPinned(isPinned("class", id, "view"));
			setCreatePinned(isPinned("class", id, "create"));
		} else if (type === "namespace") {
			setNamespacePinned(isPinned("namespace", id));
		} else if (type === "object") {
			setObjectPinned(isPinned("object", id));
		}
	}, [type, id]);

	function handleNamespaceToggle() {
		if (namespacePinned) {
			unpinItem("namespace", id);
			setNamespacePinned(false);
		} else {
			const success = pinItem({
				type: "namespace",
				id,
				name,
			});
			if (success) {
				setNamespacePinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
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
				namespaceId,
				namespaceName,
				classId,
				className,
			});
			if (success) {
				setObjectPinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
	}

	function handleToggleView() {
		if (viewPinned) {
			unpinItem("class", id, "view");
			setViewPinned(false);
		} else {
			const success = pinItem({
				type: "class",
				id,
				name,
				namespaceId,
				namespaceName,
				action: "view",
			});
			if (success) {
				setViewPinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
		setMenuOpen(false);
	}

	function handleToggleCreate() {
		if (createPinned) {
			unpinItem("class", id, "create");
			setCreatePinned(false);
		} else {
			const success = pinItem({
				type: "class",
				id,
				name,
				namespaceId,
				namespaceName,
				action: "create",
			});
			if (success) {
				setCreatePinned(true);
			} else {
				alert("Maximum 10 items can be pinned. Unpin one to add another.");
			}
		}
		setMenuOpen(false);
	}

	if (type === "namespace") {
		return (
			<button
				type="button"
				className="pin-button-inline"
				onClick={handleNamespaceToggle}
				aria-label={namespacePinned ? "Unpin this namespace" : "Pin this namespace"}
				title={namespacePinned ? "Unpin namespace" : "Pin namespace"}
			>
				<IconPin filled={namespacePinned} />
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

	// type === "class"
	const anyPinned = viewPinned || createPinned;

	return (
		<div className="pin-button-wrapper">
			<button
				type="button"
				className="pin-button-inline"
				onClick={() => setMenuOpen((current) => !current)}
				aria-label={anyPinned ? "Manage class pins" : "Pin this class"}
				aria-haspopup="menu"
				aria-expanded={isMenuOpen}
				title={anyPinned ? "Manage pins" : "Pin class"}
			>
				<IconPin filled={anyPinned} />
			</button>
			<PinMenu
				isOpen={isMenuOpen}
				onClose={() => setMenuOpen(false)}
				className={name}
				viewPinned={viewPinned}
				createPinned={createPinned}
				onToggleView={handleToggleView}
				onToggleCreate={handleToggleCreate}
			/>
		</div>
	);
}
