import type {
	Permissions,
	PrincipalTokenMetadata,
} from "@/lib/api/generated/models";
import type { TokenResourceNameMap } from "@/lib/api/token-resource-names";
import {
	type NamedTokenResourceScope,
	tokenResourceScopeKey,
} from "@/lib/token-resource-scope-selection";

export type TokenMintInitialValues = {
	description: string;
	name: string;
	permissions: Permissions[] | null;
	resources: NamedTokenResourceScope[] | null;
	sourceTokenId: number;
};

function fallbackResourceLabel(resource: NamedTokenResourceScope): string {
	const kind =
		resource.kind === "class"
			? "Class"
			: resource.kind === "object"
				? "Object"
				: "Collection";
	return `${kind} #${resource.id}`;
}

export function toTokenMintInitialValues(
	token: PrincipalTokenMetadata,
	resourceNames: TokenResourceNameMap = {},
): TokenMintInitialValues {
	const resources = token.scope?.resources?.map((resource) => {
		const namedResource: NamedTokenResourceScope = {
			...resource,
			label: resourceNames[tokenResourceScopeKey(resource)] ?? "",
		};
		return {
			...namedResource,
			label: namedResource.label || fallbackResourceLabel(namedResource),
		};
	});

	return {
		description: token.description ?? "",
		name: token.name ? `${token.name} (clone)` : "",
		permissions: token.scope?.permissions ? [...token.scope.permissions] : null,
		resources: resources ?? null,
		sourceTokenId: token.id,
	};
}
