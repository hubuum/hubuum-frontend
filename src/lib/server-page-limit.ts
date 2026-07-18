export const MAX_PAGE_LIMIT_SENTINEL = 2_147_483_647;
export const V0_0_2_PAGE_LIMIT_FALLBACK = 250;

export function resolveServerPageLimit(
	requestedLimit: number,
	advertisedLimit?: number | null,
): number {
	if (requestedLimit !== MAX_PAGE_LIMIT_SENTINEL) return requestedLimit;
	if (
		advertisedLimit !== null &&
		advertisedLimit !== undefined &&
		Number.isInteger(advertisedLimit) &&
		advertisedLimit > 0
	) {
		return advertisedLimit;
	}
	return V0_0_2_PAGE_LIMIT_FALLBACK;
}
