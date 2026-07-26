import type { NewTokenRequest, Permissions } from "@/lib/api/generated/models";
import {
	type NamedTokenResourceScope,
	toResourceScopesPayload,
} from "@/lib/token-resource-scope-selection";
import { toScopesPayload } from "@/lib/token-scope-selection";

type TokenScopeRequestInput = {
	permissions: Permissions[];
	resources: NamedTokenResourceScope[];
	restrictPermissions: boolean;
	restrictResources: boolean;
};

export function toTokenScopeRequest({
	permissions,
	resources,
	restrictPermissions,
	restrictResources,
}: TokenScopeRequestInput): Pick<NewTokenRequest, "scope"> {
	const permissionScope = toScopesPayload(restrictPermissions, permissions);
	const resourceScope = toResourceScopesPayload(restrictResources, resources);
	if (!permissionScope && !resourceScope) {
		return {};
	}

	return {
		scope: {
			...(permissionScope ? { permissions: permissionScope } : {}),
			...(resourceScope ? { resources: resourceScope } : {}),
		},
	};
}
