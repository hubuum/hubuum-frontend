import type {
	ProfilePreset,
	SchemaProfileReport,
} from "@/lib/api/generated/models";
import { SchemaApiError } from "@/lib/api/schema-evolution";

export const SCHEMA_PROFILE_PRESETS: {
	value: ProfilePreset;
	label: string;
	description: string;
}[] = [
	{
		value: "balanced",
		label: "Balanced",
		description:
			"Preserve observed types, require consistently present fields, and allow additional fields.",
	},
	{
		value: "strict",
		label: "Strict",
		description:
			"Reject mixed unrelated types, require consistently present fields, and deny additional fields.",
	},
	{
		value: "expansive",
		label: "Expansive",
		description:
			"Preserve observed types and allow optional and additional fields.",
	},
];

export function usableSchemaSuggestion(
	report: SchemaProfileReport,
	classId: number,
): boolean {
	return (
		report.class_id === classId &&
		report.status === "candidate" &&
		report.sample_valid === true &&
		report.schema != null
	);
}

export function schemaSuggestionError(error: unknown): string {
	if (error instanceof SchemaApiError) {
		if (error.status === 410)
			return "This suggestion has expired. Generate a new suggestion to review the current data.";
		if (error.status === 403)
			return "You no longer have access to this suggestion or its sampled objects. Check your access before generating another suggestion.";
		if (error.status === 404)
			return "The suggestion report is not available. Check the task or generate a new suggestion.";
	}
	return error instanceof Error
		? error.message
		: "The suggestion could not be loaded. Please try again.";
}

/** Present known profiler findings while preserving unknown details in the report. */
export function schemaSuggestionFinding(finding: unknown): {
	path: string | null;
	message: string;
} {
	if (!finding || typeof finding !== "object" || Array.isArray(finding))
		return { path: null, message: "Additional inference detail." };
	const value = finding as Record<string, unknown>;
	let path: string | null = Array.isArray(value.path) ? "$" : null;
	if (Array.isArray(value.path)) {
		for (const segment of value.path) {
			if (segment === "each_item") path += "[*]";
			else if (
				segment &&
				typeof segment === "object" &&
				"property" in segment &&
				typeof segment.property === "string"
			)
				path += `[${JSON.stringify(segment.property)}]`;
			else {
				path = null;
				break;
			}
		}
	}
	const messages: Record<string, string> = {
		string_enum:
			"The profiler evaluated whether to limit this field to an enum.",
		low_evidence: "Too few sampled objects support this inference.",
		required_from_frequency:
			"This field met the policy's frequency threshold for required properties.",
		mixed_types:
			"Multiple value types were observed. Strict inference may reject this combination.",
		observed_null: "Null values were observed at this location.",
		null_rejected:
			"The selected policy does not allow the observed null values.",
		numeric_widening:
			"Numeric values require a number schema rather than an integer-only schema.",
		optional_property: "This property is optional in the suggestion.",
		open_object: "Additional properties are allowed in this object.",
		unconstrained_items: "Array items have no inferred constraints.",
		unobserved_items: "No array items were available to infer their schema.",
		unobserved_selection: "No sampled values were available at this location.",
	};
	let message =
		typeof value.kind === "string" && Object.hasOwn(messages, value.kind)
			? messages[value.kind]
			: undefined;
	if (
		value.kind === "mixed_types" &&
		Array.isArray(value.types) &&
		value.types.length > 0 &&
		value.types.every((type) => typeof type === "string")
	)
		message = `Observed types: ${value.types.join(", ")}. Strict inference may reject this combination.`;
	return {
		path,
		message:
			message ??
			(typeof value.message === "string"
				? value.message
				: "Additional inference detail."),
	};
}
