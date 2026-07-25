import type {
	TokenResourceScope,
	TokenScopeDetails,
} from "@/lib/api/generated/models";

export type TokenResourceScopeGroups = Record<
	TokenResourceScope["kind"],
	TokenResourceScope[]
>;

function pluralize(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function groupTokenResourceScopes(
	resources: readonly TokenResourceScope[] | null | undefined,
): TokenResourceScopeGroups {
	const groups: TokenResourceScopeGroups = {
		collection: [],
		class: [],
		object: [],
	};
	for (const resource of resources ?? []) {
		groups[resource.kind].push(resource);
	}
	return groups;
}

function formatResourceScopes(resources: readonly TokenResourceScope[]): string {
	const groups = groupTokenResourceScopes(resources);

	return (
		[
			groups.collection.length
				? pluralize(groups.collection.length, "collection")
				: null,
			groups.class.length
				? pluralize(groups.class.length, "class", "classes")
				: null,
			groups.object.length
				? pluralize(groups.object.length, "object")
				: null,
		]
			.filter((part): part is string => part !== null)
			.join(", ") || "0 resources"
	);
}

export function formatTokenScopeDetails(
	scope: TokenScopeDetails | null | undefined,
): string {
	if (!scope) {
		return "Unscoped";
	}

	const permissionSummary = scope.permissions
		? pluralize(scope.permissions.length, "permission")
		: "all permissions";
	const resourceSummary = scope.resources
		? formatResourceScopes(scope.resources)
		: "all resources";
	return `${permissionSummary} · ${resourceSummary}`;
}

export function formatTokenMetadataScope(token: {
	scope?: TokenScopeDetails | null;
	scoped?: boolean;
}): string {
	if (!token.scope && token.scoped) {
		return "Scoped · details unavailable";
	}
	return formatTokenScopeDetails(token.scope);
}
