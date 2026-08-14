"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import type { HubuumObject } from "@/lib/api/generated/models";

type ObjectDirectoryLookupProps = {
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	objects: readonly HubuumObject[];
	onChange: (value: string) => void;
	onSelect: (objectItem: HubuumObject) => void;
	value: string;
};

export function ObjectDirectoryLookup({
	disabled,
	disabledHint,
	helperText,
	idPrefix,
	objects,
	onChange,
	onSelect,
	value,
}: ObjectDirectoryLookupProps) {
	const options = useMemo<DirectoryLookupOption<HubuumObject>[]>(
		() =>
			objects.map((objectItem) => ({
				id: String(objectItem.id),
				item: objectItem,
				primary: objectItem.name,
				secondary: `#${objectItem.id} · Class #${objectItem.hubuum_class_id}${
					objectItem.description.trim() ? ` · ${objectItem.description}` : ""
				}`,
				title: `${objectItem.name} (#${objectItem.id})`,
			})),
		[objects],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			helperText={helperText}
			idPrefix={idPrefix}
			inputLabel="Object name or ID"
			label="Find object"
			onChange={onChange}
			onSelect={onSelect}
			options={options}
			placeholder="Search objects in this class"
			value={value}
		/>
	);
}
