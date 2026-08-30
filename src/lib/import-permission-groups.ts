import type { ImportRequest } from "@/lib/api/generated/models";
import {
	type ConsoleGroup,
	normalizeIdentityScope,
} from "@/lib/identity-scopes";

export type ImportPermissionGroupReference = {
	key: string;
	label: string;
};

function buildScopedGroupKey(
	identityScope: string | null | undefined,
	groupname: string,
): string {
	return `${normalizeIdentityScope(identityScope)}\u0000${groupname}`;
}

export function getImportPermissionGroups(
	payload: ImportRequest,
): ImportPermissionGroupReference[] {
	const groups = new Map<string, ImportPermissionGroupReference>();

	for (const permission of payload.graph.collection_permissions ?? []) {
		const groupname = permission.group_key.groupname?.trim();
		if (!groupname) continue;

		const identityScope = normalizeIdentityScope(
			(permission.group_key as { identity_scope?: unknown }).identity_scope,
		);
		const key = buildScopedGroupKey(identityScope, groupname);
		groups.set(key, {
			key,
			label:
				identityScope === "local"
					? groupname
					: `${identityScope}/${groupname}`,
		});
	}

	return Array.from(groups.values()).sort((left, right) =>
		left.label.localeCompare(right.label),
	);
}

export function findMissingImportPermissionGroups(
	references: readonly ImportPermissionGroupReference[],
	groups: readonly ConsoleGroup[],
): string[] {
	const existingGroupKeys = new Set(
		groups.map((group) =>
			buildScopedGroupKey(group.identity_scope, group.groupname),
		),
	);
	return references
		.filter((reference) => !existingGroupKeys.has(reference.key))
		.map((reference) => reference.label);
}
