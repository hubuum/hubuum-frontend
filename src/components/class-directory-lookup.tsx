"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import type { HubuumClassExpanded } from "@/lib/api/generated/models";

type ClassDirectoryLookupProps = {
	classes: readonly HubuumClassExpanded[];
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	onChange: (value: string) => void;
	onSelect: (hubuumClass: HubuumClassExpanded) => void;
	value: string;
};

export function ClassDirectoryLookup({
	classes,
	disabled,
	disabledHint,
	helperText,
	idPrefix,
	onChange,
	onSelect,
	value,
}: ClassDirectoryLookupProps) {
	const options = useMemo<DirectoryLookupOption<HubuumClassExpanded>[]>(
		() =>
			classes.map((hubuumClass) => ({
				id: String(hubuumClass.id),
				item: hubuumClass,
				primary: hubuumClass.name,
				secondary: `#${hubuumClass.id} · Collection ${hubuumClass.collection.name} (#${hubuumClass.collection.id})${
					hubuumClass.description.trim() ? ` · ${hubuumClass.description}` : ""
				}`,
				title: `${hubuumClass.name} (#${hubuumClass.id})`,
			})),
		[classes],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			helperText={helperText}
			idPrefix={idPrefix}
			inputLabel="Class name"
			label="Find class"
			onChange={onChange}
			onSelect={onSelect}
			options={options}
			placeholder="Search class names"
			value={value}
		/>
	);
}
