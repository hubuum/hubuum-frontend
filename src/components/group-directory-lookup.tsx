"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import {
	type ConsoleGroup,
	formatScopedGroupName,
} from "@/lib/identity-scopes";

type GroupDirectoryLookupProps = {
	disabled?: boolean;
	disabledHint?: string;
	groups: readonly ConsoleGroup[];
	helperText: ReactNode;
	idPrefix: string;
	onChange: (value: string) => void;
	onSelect: (group: ConsoleGroup) => void;
	value: string;
};

export function GroupDirectoryLookup({
	disabled,
	disabledHint,
	groups,
	helperText,
	idPrefix,
	onChange,
	onSelect,
	value,
}: GroupDirectoryLookupProps) {
	const options = useMemo<DirectoryLookupOption<ConsoleGroup>[]>(
		() =>
			groups.map((group) => ({
				id: String(group.id),
				item: group,
				primary: formatScopedGroupName(group),
				secondary: `#${group.id}${
					group.description.trim() ? ` · ${group.description}` : ""
				}`,
				title: `${formatScopedGroupName(group)} (#${group.id})`,
			})),
		[groups],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			helperText={helperText}
			idPrefix={idPrefix}
			inputLabel="Group name or ID"
			label="Find group"
			onChange={onChange}
			onSelect={onSelect}
			options={options}
			placeholder="Search groups"
			value={value}
		/>
	);
}
