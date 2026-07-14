import type { ObjectPropertyPathSegment } from "@/lib/object-property-entries";

export type ObjectDataFieldType =
	| "string"
	| "number"
	| "boolean"
	| "null"
	| "object"
	| "array";

export type ObjectDataPathResult =
	| { ok: true; segments: ObjectPropertyPathSegment[] }
	| { ok: false; error: string };

export type ObjectDataValueResult =
	| { ok: true; value: unknown }
	| { ok: false; error: string };

export type ObjectDataLookupResult =
	| { found: true; value: unknown }
	| { found: false; value: undefined };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBracketSegment(
	source: string,
	startIndex: number,
):
	| { ok: true; segment: ObjectPropertyPathSegment; nextIndex: number }
	| { ok: false; error: string } {
	const contentStart = startIndex + 1;
	if (contentStart >= source.length) {
		return { ok: false, error: "Data field path has an unclosed bracket." };
	}

	if (source[contentStart] === '"') {
		let quoteEnd = contentStart + 1;
		let escaped = false;
		for (; quoteEnd < source.length; quoteEnd += 1) {
			const character = source[quoteEnd];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') {
				break;
			}
		}

		if (quoteEnd >= source.length || source[quoteEnd + 1] !== "]") {
			return {
				ok: false,
				error: "Quoted data field keys must end with a closing bracket.",
			};
		}

		try {
			const segment = JSON.parse(
				source.slice(contentStart, quoteEnd + 1),
			) as unknown;
			if (typeof segment !== "string") {
				return { ok: false, error: "Quoted path segments must be strings." };
			}
			return { ok: true, segment, nextIndex: quoteEnd + 2 };
		} catch {
			return { ok: false, error: "Data field path contains an invalid key." };
		}
	}

	const bracketEnd = source.indexOf("]", contentStart);
	if (bracketEnd < 0) {
		return { ok: false, error: "Data field path has an unclosed bracket." };
	}
	const indexText = source.slice(contentStart, bracketEnd);
	if (!/^(0|[1-9]\d*)$/.test(indexText)) {
		return {
			ok: false,
			error: "Array positions must be non-negative whole numbers.",
		};
	}

	return {
		ok: true,
		segment: Number.parseInt(indexText, 10),
		nextIndex: bracketEnd + 1,
	};
}

export function parseObjectDataPath(input: string): ObjectDataPathResult {
	const source = input.trim();
	if (!source) {
		return { ok: false, error: "Enter a path for the new data field." };
	}
	if (source === "$") {
		return { ok: true, segments: [] };
	}

	const segments: ObjectPropertyPathSegment[] = [];
	let index = 0;
	while (index < source.length) {
		if (source[index] === ".") {
			return { ok: false, error: "Data field path contains an empty segment." };
		}

		if (source[index] === "[") {
			const bracket = parseBracketSegment(source, index);
			if (!bracket.ok) {
				return bracket;
			}
			segments.push(bracket.segment);
			index = bracket.nextIndex;
		} else {
			let key = "";
			while (
				index < source.length &&
				source[index] !== "." &&
				source[index] !== "["
			) {
				const character = source[index];
				if (character === "\\") {
					index += 1;
					if (index >= source.length) {
						return {
							ok: false,
							error: "Data field path ends with an incomplete escape.",
						};
					}
					key += source[index];
					index += 1;
					continue;
				}
				key += character;
				index += 1;
			}

			if (!key) {
				return { ok: false, error: "Data field path contains an empty key." };
			}
			segments.push(key);
		}

		if (index >= source.length) {
			break;
		}
		if (source[index] === "[") {
			continue;
		}
		if (source[index] !== ".") {
			return { ok: false, error: "Data field path is invalid." };
		}

		index += 1;
		if (index >= source.length || source[index] === ".") {
			return { ok: false, error: "Data field path contains an empty segment." };
		}
	}

	return { ok: true, segments };
}

export function getObjectDataValue(
	root: unknown,
	segments: readonly ObjectPropertyPathSegment[],
): ObjectDataLookupResult {
	let current = root;
	for (const segment of segments) {
		if (typeof segment === "number") {
			if (
				!Array.isArray(current) ||
				segment >= current.length ||
				!(segment in current)
			) {
				return { found: false, value: undefined };
			}
			current = current[segment];
			continue;
		}

		if (!isRecord(current) || !Object.hasOwn(current, segment)) {
			return { found: false, value: undefined };
		}
		current = current[segment];
	}

	return { found: true, value: current };
}

function emptyContainerFor(
	segment: ObjectPropertyPathSegment,
): Record<string, unknown> | unknown[] {
	return typeof segment === "number" ? [] : {};
}

export function setObjectDataValue(
	root: unknown,
	segments: readonly ObjectPropertyPathSegment[],
	value: unknown,
): ObjectDataValueResult {
	if (segments.length === 0) {
		return { ok: true, value };
	}

	function update(current: unknown, segmentIndex: number): ObjectDataValueResult {
		const segment = segments[segmentIndex];
		if (segment === undefined) {
			return { ok: true, value };
		}
		const isLast = segmentIndex === segments.length - 1;

		if (typeof segment === "number") {
			if (!Array.isArray(current)) {
				return {
					ok: false,
					error: `Path position ${segment} requires an array.`,
				};
			}
			if (segment > current.length) {
				return {
					ok: false,
					error: `Array position ${segment} would skip existing positions.`,
				};
			}

			const nextArray = [...current];
			if (isLast) {
				nextArray[segment] = value;
				return { ok: true, value: nextArray };
			}

			const nextSegment = segments[segmentIndex + 1];
			const child =
				segment < current.length
					? current[segment]
					: emptyContainerFor(nextSegment);
			const updatedChild = update(child, segmentIndex + 1);
			if (!updatedChild.ok) {
				return updatedChild;
			}
			nextArray[segment] = updatedChild.value;
			return { ok: true, value: nextArray };
		}

		if (!isRecord(current)) {
			return { ok: false, error: `Path key “${segment}” requires an object.` };
		}
		if (isLast) {
			return { ok: true, value: { ...current, [segment]: value } };
		}

		const nextSegment = segments[segmentIndex + 1];
		const child = Object.hasOwn(current, segment)
			? current[segment]
			: emptyContainerFor(nextSegment);
		const updatedChild = update(child, segmentIndex + 1);
		if (!updatedChild.ok) {
			return updatedChild;
		}
		return {
			ok: true,
			value: { ...current, [segment]: updatedChild.value },
		};
	}

	return update(root, 0);
}

export function getObjectDataFieldType(value: unknown): ObjectDataFieldType {
	if (value === null) {
		return "null";
	}
	if (Array.isArray(value)) {
		return "array";
	}
	if (isRecord(value)) {
		return "object";
	}
	if (typeof value === "number") {
		return "number";
	}
	if (typeof value === "boolean") {
		return "boolean";
	}
	return "string";
}

export function createObjectDataFieldValue(
	type: ObjectDataFieldType,
	input: string,
): ObjectDataValueResult {
	if (type === "string") {
		return { ok: true, value: input };
	}
	if (type === "number") {
		if (!input.trim()) {
			return { ok: false, error: "Enter a number for the new field." };
		}
		const value = Number(input);
		return Number.isFinite(value)
			? { ok: true, value }
			: { ok: false, error: "Enter a valid finite number." };
	}
	if (type === "boolean") {
		return { ok: true, value: input === "true" };
	}
	if (type === "null") {
		return { ok: true, value: null };
	}
	if (type === "array") {
		return { ok: true, value: [] };
	}
	return { ok: true, value: {} };
}
