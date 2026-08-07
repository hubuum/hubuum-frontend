export function getPasswordConfirmationError(
	password: string,
	confirmation: string,
): string | null {
	if (!password && !confirmation) return null;
	return password === confirmation ? null : "Passwords do not match.";
}
