"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import type { Collection } from "@/lib/api/generated/models";

type CollectionDirectoryLookupProps = {
	collections: readonly Collection[];
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	onChange: (value: string) => void;
	onSelect: (collection: Collection) => void;
	value: string;
};

export function CollectionDirectoryLookup({
	collections,
	disabled,
	disabledHint,
	helperText,
	idPrefix,
	onChange,
	onSelect,
	value,
}: CollectionDirectoryLookupProps) {
	const options = useMemo<DirectoryLookupOption<Collection>[]>(
		() =>
			collections.map((collection) => ({
				id: String(collection.id),
				item: collection,
				primary: collection.name,
				secondary: `#${collection.id}${
					collection.parent_collection_id == null
						? " · Root collection"
						: ` · Parent #${collection.parent_collection_id}`
				}${collection.description.trim() ? ` · ${collection.description}` : ""}`,
				title: `${collection.name} (#${collection.id})`,
			})),
		[collections],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			helperText={helperText}
			idPrefix={idPrefix}
			inputLabel="Collection name or ID"
			label="Find collection"
			onChange={onChange}
			onSelect={onSelect}
			options={options}
			placeholder="Search collections"
			value={value}
		/>
	);
}
