"use client";

import { useEffect, useRef } from "react";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

interface PinMenuProps {
	isOpen: boolean;
	onClose: () => void;
	className: string;
	viewPinned: boolean;
	createPinned: boolean;
	onToggleView: () => void;
	onToggleCreate: () => void;
}

export function PinMenu({
	isOpen,
	onClose,
	className,
	viewPinned,
	createPinned,
	onToggleView,
	onToggleCreate,
}: PinMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);
	useEscapeToCancel({ enabled: isOpen, onCancel: onClose });

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		function handleClickOutside(event: MouseEvent) {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
				onClose();
			}
		}

		document.addEventListener("mousedown", handleClickOutside);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen, onClose]);

	if (!isOpen) {
		return null;
	}

	return (
		<div ref={menuRef} className="pin-menu" role="menu">
			<button
				type="button"
				className={`pin-menu-option ${viewPinned ? "pin-menu-option--checked" : ""}`}
				onClick={onToggleView}
				role="menuitem"
			>
				<span className="pin-menu-check">{viewPinned ? "✓" : ""}</span>
				<span>View objects in {className}</span>
			</button>
			<button
				type="button"
				className={`pin-menu-option ${createPinned ? "pin-menu-option--checked" : ""}`}
				onClick={onToggleCreate}
				role="menuitem"
			>
				<span className="pin-menu-check">{createPinned ? "✓" : ""}</span>
				<span>Create object in {className}</span>
			</button>
		</div>
	);
}
