"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import {
	formatGroupMembershipCandidateOption,
	type GroupMembershipCandidate,
	groupMembershipCandidateKindLabel,
} from "@/lib/group-membership-candidates";
import { formatScopedIdentityName } from "@/lib/identity-scopes";

type GroupMemberLookupProps = {
	candidates: readonly GroupMembershipCandidate[];
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	onChange: (value: string) => void;
	onSelect: (candidate: GroupMembershipCandidate) => void;
	value: string;
};

export function GroupMemberLookup({
	candidates,
	disabled,
	disabledHint,
	helperText,
	idPrefix,
	onChange,
	onSelect,
	value,
}: GroupMemberLookupProps) {
	const options = useMemo<DirectoryLookupOption<GroupMembershipCandidate>[]>(
		() =>
			candidates.map((candidate) => ({
				id: `${candidate.kind}-${candidate.id}`,
				item: candidate,
				primary: formatScopedIdentityName(
					candidate.identityScope,
					candidate.name,
				),
				secondary: `#${candidate.id} · ${groupMembershipCandidateKindLabel(candidate)}${
					candidate.detail ? ` · ${candidate.detail}` : ""
				}`,
				title: formatGroupMembershipCandidateOption(candidate),
			})),
		[candidates],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			helperText={helperText}
			idPrefix={idPrefix}
			inputLabel="Name or principal ID"
			label="Find member"
			onChange={onChange}
			onSelect={onSelect}
			options={options}
			placeholder="Search users and service accounts"
			value={value}
		/>
	);
}
