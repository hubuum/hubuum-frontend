import type { TokenResourceScope } from "@/lib/api/generated/models";

export const MAX_TOKEN_RESOURCE_SCOPES = 1000;

export type NamedTokenResourceScope = TokenResourceScope & {
	label: string;
};

export function tokenResourceScopeKey(
	scope: Pick<TokenResourceScope, "id" | "kind">,
): string {
	return `${scope.kind}:${scope.id}`;
}

export function toResourceScopesPayload(
	restrict: boolean,
	selected: NamedTokenResourceScope[],
): TokenResourceScope[] | undefined {
	if (!restrict || selected.length === 0) {
		return undefined;
	}

	return selected.map(({ id, kind }) => ({ id, kind }) as TokenResourceScope);
}

export function canSubmitResourceScopes(
	restrict: boolean,
	selected: NamedTokenResourceScope[],
): boolean {
	if (!restrict) {
		return true;
	}

	return selected.length > 0 && selected.length <= MAX_TOKEN_RESOURCE_SCOPES;
}

export function countResourceScopesByKind(
	selected: NamedTokenResourceScope[],
): Record<TokenResourceScope["kind"], number> {
	const counts = {
		collection: 0,
		class: 0,
		object: 0,
	};

	for (const scope of selected) {
		counts[scope.kind] += 1;
	}

	return counts;
}
