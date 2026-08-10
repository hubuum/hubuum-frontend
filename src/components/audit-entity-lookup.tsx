"use client";

import { type ReactNode, useMemo } from "react";
import {
	AuditSearchLookup,
	type AuditSearchOption,
} from "@/components/audit-search-lookup";
import type { AuditEntityCandidate } from "@/lib/audit-entity-options";

type AuditEntityLookupProps = {
	candidates: readonly AuditEntityCandidate[];
	disabled?: boolean;
	disabledHint?: string;
	helperText: ReactNode;
	onChange: (value: string) => void;
	onSelect: (candidate: AuditEntityCandidate) => void;
	placeholder: string;
	value: string;
};

function entityKindLabel(candidate: AuditEntityCandidate): string {
	return candidate.kind.replaceAll("_", " ");
}

export function AuditEntityLookup({
	candidates,
	disabled,
	disabledHint,
	helperText,
	onChange,
	onSelect,
	placeholder,
	value,
}: AuditEntityLookupProps) {
	const options = useMemo<AuditSearchOption<AuditEntityCandidate>[]>(
		() =>
			candidates.map((candidate) => ({
				id: `${candidate.kind}-${candidate.id}`,
				item: candidate,
				primary: candidate.inputValue,
				secondary: `#${candidate.id} · ${entityKindLabel(candidate)}${
					candidate.details.length ? ` · ${candidate.details.join(" · ")}` : ""
				}`,
				title: `${candidate.inputValue} (#${candidate.id})`,
			})),
		[candidates],
	);

	return (
		<AuditSearchLookup
			disabled={disabled}
			disabledHint={disabledHint}
			idPrefix="audit-entity"
			inputLabel="Name"
			label="Find entity"
			value={value}
			options={options}
			onChange={onChange}
			onSelect={onSelect}
			placeholder={placeholder}
			helperText={helperText}
		/>
	);
}
