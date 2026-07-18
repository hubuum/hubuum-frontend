"use client";

import type { Permissions } from "@/lib/api/generated/models";
import { SCOPE_GROUPS } from "@/lib/token-scopes";

type ScopePickerProps = {
	restrict: boolean;
	selected: Permissions[];
	disabled?: boolean;
	showRestrictionToggle?: boolean;
	onChange: (restrict: boolean, selected: Permissions[]) => void;
};

export function ScopePicker({
	restrict,
	selected,
	disabled,
	showRestrictionToggle = true,
	onChange,
}: ScopePickerProps) {
	const selectedSet = new Set(selected);

	function toggleScope(scope: Permissions, checked: boolean) {
		const next = new Set(selectedSet);
		if (checked) {
			next.add(scope);
		} else {
			next.delete(scope);
		}
		onChange(restrict, [...next]);
	}

	return (
		<div className="stack">
			{showRestrictionToggle ? (
				<label className="control-field">
					<span>Scopes</span>
					<label className="checkbox-row">
						<input
							type="checkbox"
							checked={restrict}
							disabled={disabled}
							onChange={(event) => onChange(event.target.checked, selected)}
						/>
						<span>Restrict this token to specific permissions</span>
					</label>
				</label>
			) : null}

			{restrict ? (
				<div className="scope-grid">
					{SCOPE_GROUPS.map((group) => (
						<fieldset key={group.label} className="scope-group">
							<legend>{group.label}</legend>
							{group.scopes.map((scope) => (
								<label key={scope} className="checkbox-row">
									<input
										type="checkbox"
										checked={selectedSet.has(scope)}
										disabled={disabled}
										onChange={(event) =>
											toggleScope(scope, event.target.checked)
										}
									/>
									<span>{scope}</span>
								</label>
							))}
						</fieldset>
					))}
				</div>
			) : (
				<p className="muted">
					Unscoped — this token carries the principal&apos;s full authority.
				</p>
			)}
		</div>
	);
}
