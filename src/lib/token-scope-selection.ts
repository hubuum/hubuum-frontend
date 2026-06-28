import type { Permissions } from "@/lib/api/generated/models";

/**
 * Maps the picker state to the API `scopes` field. Fail-closed semantics:
 * unrestricted => omit (unscoped); restricted with selections => the array;
 * restricted with no selections => undefined (we never send `[]`, which the
 * backend rejects with 400).
 */
export function toScopesPayload(
	restrict: boolean,
	selected: Permissions[],
): Permissions[] | undefined {
	if (!restrict || selected.length === 0) {
		return undefined;
	}

	return selected;
}

export function canSubmitScopes(
	restrict: boolean,
	selected: Permissions[],
): boolean {
	if (!restrict) {
		return true;
	}

	return selected.length > 0;
}
