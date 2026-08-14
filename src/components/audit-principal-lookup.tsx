"use client";

import { type ReactNode, useMemo } from "react";
import {
	DirectoryLookupPopover,
	type DirectoryLookupOption,
} from "@/components/directory-lookup-popover";
import {
	auditActorCandidateInputValue,
	type AuditActorCandidate,
	formatAuditActorCandidate,
} from "@/lib/audit-actor-options";

type AuditPrincipalLookupProps = {
	candidates: readonly AuditActorCandidate[];
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	idPrefix: string;
	label: string;
	onChange: (value: string) => void;
	onSelect: (candidate: AuditActorCandidate) => void;
	placeholder: string;
	value: string;
};

function candidateKindLabel(candidate: AuditActorCandidate): string {
	return candidate.kind === "service_account" ? "Service account" : "User";
}

export function AuditPrincipalLookup({
	candidates,
	disabled,
	disabledHint,
	helperText,
	idPrefix,
	label,
	onChange,
	onSelect,
	placeholder,
	value,
}: AuditPrincipalLookupProps) {
	const options = useMemo<DirectoryLookupOption<AuditActorCandidate>[]>(
		() =>
			candidates.map((candidate) => ({
				id: `${candidate.kind}-${candidate.id}`,
				item: candidate,
				primary: auditActorCandidateInputValue(candidate),
				secondary: `#${candidate.id} · ${candidateKindLabel(candidate)}${
					candidate.details.length ? ` · ${candidate.details.join(" · ")}` : ""
				}`,
				title: formatAuditActorCandidate(candidate),
			})),
		[candidates],
	);

	return (
		<DirectoryLookupPopover
			disabled={disabled}
			disabledHint={disabledHint}
			idPrefix={idPrefix}
			inputLabel="Name"
			label={label}
			value={value}
			options={options}
			onChange={onChange}
			onSelect={onSelect}
			placeholder={placeholder}
			helperText={helperText}
		/>
	);
}
