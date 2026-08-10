"use client";

import { type ReactNode, useMemo } from "react";
import {
	AuditSearchLookup,
	type AuditSearchOption,
} from "@/components/audit-search-lookup";
import type { AuditEntityCandidate } from "@/lib/audit-entity-options";

type AuditEntityLookupProps = {
	candidates: readonly AuditEntityCandidate[];
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
			idPrefix="audit-entity"
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
