export function AuditMatchControl({
	mode,
	onChange,
	nameDisabled = false,
}: {
	mode: string;
	onChange: (mode: "id" | "name") => void;
	nameDisabled?: boolean;
}) {
	return (
		<fieldset
			className="segmented-control audit-match-control"
			aria-label="Match history by"
		>
			{(
				[
					["id", "Entity ID"],
					["name", "Recorded name"],
				] as const
			).map(([value, label]) => (
				<button
					key={value}
					type="button"
					className={mode === value ? "is-active" : ""}
					aria-pressed={mode === value}
					disabled={value === "name" && nameDisabled}
					onClick={() => onChange(value)}
				>
					{label}
				</button>
			))}
		</fieldset>
	);
}
