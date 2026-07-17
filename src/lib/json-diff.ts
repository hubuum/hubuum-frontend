export const JSON_DIFF_MISSING_VALUE = "(not present)";

export type JsonDifference = {
	changeCount: number;
	value: unknown;
};

type DifferenceNode = {
	changeCount: number;
	value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) && Array.isArray(right)) {
		return (
			left.length === right.length &&
			left.every((value, index) => jsonValuesEqual(value, right[index]))
		);
	}

	if (isRecord(left) && isRecord(right)) {
		const leftKeys = Object.keys(left);
		const rightKeys = Object.keys(right);
		return (
			leftKeys.length === rightKeys.length &&
			leftKeys.every(
				(key) =>
					Object.hasOwn(right, key) && jsonValuesEqual(left[key], right[key]),
			)
		);
	}

	return false;
}

export function decodeNestedJsonStrings(
	value: unknown,
	remainingLayers = 2,
): unknown {
	if (typeof value === "string" && remainingLayers > 0) {
		const trimmed = value.trim();
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
			try {
				const parsed = JSON.parse(trimmed) as unknown;
				if (Array.isArray(parsed) || isRecord(parsed)) {
					return decodeNestedJsonStrings(parsed, remainingLayers - 1);
				}
			} catch {
				return value;
			}
		}
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => decodeNestedJsonStrings(item, remainingLayers));
	}

	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				decodeNestedJsonStrings(item, remainingLayers),
			]),
		);
	}

	return value;
}

function changedLeaf(
	before: unknown,
	beforeExists: boolean,
	after: unknown,
	afterExists: boolean,
): DifferenceNode {
	return {
		changeCount: 1,
		value: {
			before: beforeExists
				? decodeNestedJsonStrings(before)
				: JSON_DIFF_MISSING_VALUE,
			after: afterExists
				? decodeNestedJsonStrings(after)
				: JSON_DIFF_MISSING_VALUE,
		},
	};
}

function buildDifferenceNode(
	before: unknown,
	beforeExists: boolean,
	after: unknown,
	afterExists: boolean,
): DifferenceNode | null {
	if (!beforeExists || !afterExists) {
		return changedLeaf(before, beforeExists, after, afterExists);
	}
	if (jsonValuesEqual(before, after)) {
		return null;
	}

	if (isRecord(before) && isRecord(after)) {
		const value: Record<string, unknown> = {};
		let changeCount = 0;
		const keys = Array.from(
			new Set([...Object.keys(before), ...Object.keys(after)]),
		).sort((left, right) => left.localeCompare(right));

		for (const key of keys) {
			const child = buildDifferenceNode(
				before[key],
				Object.hasOwn(before, key),
				after[key],
				Object.hasOwn(after, key),
			);
			if (child) {
				value[key] = child.value;
				changeCount += child.changeCount;
			}
		}

		return changeCount > 0 ? { changeCount, value } : null;
	}

	return changedLeaf(before, true, after, true);
}

export function buildJsonDifference(
	before: unknown,
	after: unknown,
): JsonDifference | null {
	return buildDifferenceNode(
		before,
		before !== undefined,
		after,
		after !== undefined,
	);
}

export function formatJsonDifference(value: unknown): string {
	return JSON.stringify(value, null, 2) ?? String(value);
}
