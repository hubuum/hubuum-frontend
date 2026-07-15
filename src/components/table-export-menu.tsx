"use client";

import {
	type KeyboardEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import {
	createTableExportFile,
	createTableExportSnapshot,
	downloadTableExportFile,
	TABLE_EXPORT_FORMATS,
	type TableExportFormat,
	type TableExportView,
} from "@/lib/table-export";
import { useToast } from "@/lib/toast-context";
import { useEscapeToCancel } from "@/lib/use-escape-to-cancel";

function IconExport() {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M12 3v11m0 0 4-4m-4 4-4-4M5 14v5h14v-5"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
		</svg>
	);
}

type TableExportMenuProps<Row> = {
	view: TableExportView<Row>;
	disabled?: boolean;
	compact?: boolean;
};

export function TableExportMenu<Row>({
	view,
	disabled = false,
	compact = false,
}: TableExportMenuProps<Row>) {
	const menuId = useId();
	const rootRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const [isOpen, setOpen] = useState(false);
	const [activeFormat, setActiveFormat] = useState<TableExportFormat | null>(
		null,
	);
	const { showToast } = useToast();
	const isDisabled = disabled || view.rows.length === 0 || view.columns.length === 0;
	useEscapeToCancel({
		enabled: isOpen,
		onCancel: () => {
			setOpen(false);
			window.setTimeout(() => triggerRef.current?.focus(), 0);
		},
	});

	useEffect(() => {
		if (!isOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				setOpen(false);
			}
		};
		window.addEventListener("pointerdown", onPointerDown);
		return () => window.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen]);

	function openMenu() {
		if (isDisabled) return;
		setOpen(true);
		window.setTimeout(() => itemRefs.current[0]?.focus(), 0);
	}

	function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		const currentIndex = itemRefs.current.indexOf(
			document.activeElement as HTMLButtonElement | null,
		);
		let nextIndex: number | null = null;
		if (event.key === "ArrowDown") {
			nextIndex = (currentIndex + 1) % TABLE_EXPORT_FORMATS.length;
		} else if (event.key === "ArrowUp") {
			nextIndex =
				(currentIndex - 1 + TABLE_EXPORT_FORMATS.length) %
				TABLE_EXPORT_FORMATS.length;
		} else if (event.key === "Home") {
			nextIndex = 0;
		} else if (event.key === "End") {
			nextIndex = TABLE_EXPORT_FORMATS.length - 1;
		}
		if (nextIndex !== null) {
			event.preventDefault();
			itemRefs.current[nextIndex]?.focus();
		}
	}

	async function exportView(format: TableExportFormat) {
		setActiveFormat(format);
		setOpen(false);
		try {
			// Capture the rendered view before the asynchronously loaded writer runs.
			const snapshot = createTableExportSnapshot(view);
			const file = await createTableExportFile(snapshot, format);
			const fileName = downloadTableExportFile(snapshot, file);
			showToast(
				`Exported ${snapshot.rows.length} row${snapshot.rows.length === 1 ? "" : "s"} to ${fileName}.`,
				"success",
			);
		} catch (error) {
			showToast(
				error instanceof Error ? error.message : "Could not export this view.",
				"error",
			);
		} finally {
			setActiveFormat(null);
			window.setTimeout(() => triggerRef.current?.focus(), 0);
		}
	}

	return (
		<div className="table-export" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="ghost table-export-trigger"
				disabled={isDisabled || activeFormat !== null}
				aria-haspopup="menu"
				aria-expanded={isOpen}
				aria-controls={isOpen ? menuId : undefined}
				onClick={() => (isOpen ? setOpen(false) : openMenu())}
			>
				<IconExport />
				<span>{activeFormat ? "Preparing…" : compact ? "Export" : "Export view"}</span>
			</button>
			{isOpen ? (
				<div
					id={menuId}
					className="table-export-menu card"
					role="menu"
					onKeyDown={onMenuKeyDown}
				>
					<div className="table-export-summary">
						<strong>Current view</strong>
						<span>
							{view.rows.length} row{view.rows.length === 1 ? "" : "s"} ·{" "}
							{view.columns.length} column{view.columns.length === 1 ? "" : "s"}
						</span>
					</div>
					<div className="table-export-options">
						{TABLE_EXPORT_FORMATS.map((item, index) => (
							<button
								key={item.format}
								ref={(node) => {
									itemRefs.current[index] = node;
								}}
								type="button"
								className="ghost table-export-option"
								role="menuitem"
								onClick={() => exportView(item.format)}
							>
								<span>{item.label}</span>
								<small>{item.description}</small>
							</button>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
