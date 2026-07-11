export function canManageCollectionPermissions(
	canAdminister: boolean,
	hasDelegatedAccess: boolean,
): boolean {
	return canAdminister || hasDelegatedAccess;
}
