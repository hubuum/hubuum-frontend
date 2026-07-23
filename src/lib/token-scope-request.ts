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
}: TokenScopeRequestInput): Pick<
	NewTokenRequest,
	"resource_scopes" | "scopes"
> {
	const request: Pick<NewTokenRequest, "resource_scopes" | "scopes"> = {};
	const scopes = toScopesPayload(restrictPermissions, permissions);
	if (scopes) {
		request.scopes = scopes;
	}
	const resourceScopes = toResourceScopesPayload(restrictResources, resources);
	if (resourceScopes) {
		request.resource_scopes = resourceScopes;
	}
	return request;
}
