import type {
	PrincipalSettings,
	PrincipalSettingsPatchDocument,
} from "@/lib/api/generated/models";
export type SettingsEditMode = "replace" | "merge" | "patch";
export function parseSettingsEdit(
	text: string,
	mode: "replace" | "merge",
): PrincipalSettings;
export function parseSettingsEdit(
	text: string,
	mode: SettingsEditMode,
): PrincipalSettings | PrincipalSettingsPatchDocument;
export function parseSettingsEdit(
	text: string,
	mode: SettingsEditMode,
): PrincipalSettings | PrincipalSettingsPatchDocument {
	const value: unknown = JSON.parse(text);
	if (mode !== "patch") {
		if (!value || typeof value !== "object" || Array.isArray(value))
			throw new Error("Settings must be a JSON object.");
		return value as PrincipalSettings;
	}
	if (!Array.isArray(value) || value.length > 1000)
		throw new Error(
			"JSON Patch requires an array of at most 1,000 operations.",
		);
	return value.map((item: unknown) => {
		if (
			!item ||
			typeof item !== "object" ||
			!("op" in item) ||
			!("path" in item) ||
			typeof item.path !== "string"
		)
			throw new Error("Each operation needs an op and a JSON Pointer path.");
		const { op, path } = item;
		if (path !== "" && !path.startsWith("/"))
			throw new Error("JSON Pointer paths must start with / or be empty.");
		switch (op) {
			case "add":
			case "replace":
			case "test":
				if (!("value" in item)) throw new Error(`${op} requires a value.`);
				return { op, path, value: item.value };
			case "remove":
				return { op, path };
			case "copy":
			case "move":
				if (
					!("from" in item) ||
					typeof item.from !== "string" ||
					(item.from !== "" && !item.from.startsWith("/"))
				)
					throw new Error(`${op} requires a JSON Pointer from path.`);
				return { op, path, from: item.from };
			default:
				throw new Error("Unsupported JSON Patch operation.");
		}
	});
}
