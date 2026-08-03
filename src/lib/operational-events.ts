import "server-only";

export type OperationalLogLevel = "info" | "warn" | "error";
export type OperationalLogFields = Record<string, unknown>;

const SERVICE_NAME = "hubuum-frontend";
const MAX_FIELD_STRING_LENGTH = 512;
const MAX_PATH_LENGTH = 1024;
const MAX_QUERY_FIELDS = 24;
const EVENT_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const SENSITIVE_FIELD_PATTERN =
	/(^|_)(api[_-]?key|authorization|body|capability|cookie|password|payload|secret|session_id|sid|token)(_|$)/i;

function truncate(value: string, maximum: number): string {
	if (value.length <= maximum) {
		return value;
	}
	return `${value.slice(0, Math.max(0, maximum - 1))}…`;
}

export function redactOperationalText(value: string): string {
	return value
		.replace(/\bBearer\s+[^\s,;?&]+/gi, "Bearer [redacted]")
		.replace(
			/([?&](?:api[_-]?key|capability|password|secret|token)=)[^&\s]+/gi,
			"$1[redacted]",
		)
		.replace(
			/\b(api[_-]?key|capability|password|secret|token)\s*[:=]\s*[^\s,;&]+/gi,
			"$1=[redacted]",
		);
}

export function sanitizeOperationalPath(value: string): string {
	const withSlash = value.startsWith("/") ? value : `/${value}`;
	const withoutFragment = withSlash.split("#", 1)[0] ?? "/";
	const separator = withoutFragment.indexOf("?");
	const rawPath = separator === -1
		? withoutFragment
		: withoutFragment.slice(0, separator);
	const query = separator === -1 ? "" : withoutFragment.slice(separator + 1);
	const safePath = rawPath
		.replace(/(\/auth\/logout\/token\/)[^/]+/gi, "$1[redacted]")
		.replace(/[\u0000-\u001f\u007f]/g, "");

	if (!query) {
		return truncate(safePath, MAX_PATH_LENGTH);
	}

	const fields = [];
	const params = new URLSearchParams(query);
	for (const key of params.keys()) {
		if (fields.length >= MAX_QUERY_FIELDS) {
			fields.push("…");
			break;
		}
		fields.push(`${encodeURIComponent(truncate(key, 96))}=[redacted]`);
	}
	const suffix = fields.length > 0 ? `?${fields.join("&")}` : "";
	return truncate(`${safePath}${suffix}`, MAX_PATH_LENGTH);
}

function sanitizeFieldValue(value: unknown): string | number | boolean | null | undefined {
	if (value === null) {
		return null;
	}
	if (typeof value === "string") {
		return truncate(redactOperationalText(value), MAX_FIELD_STRING_LENGTH);
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "boolean") {
		return value;
	}
	return undefined;
}

export function operationalErrorFields(error: unknown): OperationalLogFields {
	if (error instanceof Error) {
		return {
			error_message: error.message,
			error_name: error.name || "Error",
		};
	}
	return {
		error_message: String(error),
		error_name: "NonError",
	};
}

export function formatOperationalEvent(
	level: OperationalLogLevel,
	event: string,
	fields: OperationalLogFields = {},
	now: () => Date = () => new Date(),
): Record<string, string | number | boolean | null> {
	if (!EVENT_PATTERN.test(event)) {
		throw new Error(`Invalid operational event name: ${event}`);
	}

	const record: Record<string, string | number | boolean | null> = {
		timestamp: now().toISOString(),
		level,
		service: SERVICE_NAME,
		event,
	};
	for (const key of Object.keys(fields).sort()) {
		if (
			key in record ||
			!EVENT_PATTERN.test(key) ||
			SENSITIVE_FIELD_PATTERN.test(key)
		) {
			continue;
		}
		const value = sanitizeFieldValue(fields[key]);
		if (value !== undefined) {
			record[key] = value;
		}
	}
	return record;
}

export function emitOperationalEvent(
	level: OperationalLogLevel,
	event: string,
	fields: OperationalLogFields = {},
): void {
	const line = JSON.stringify(formatOperationalEvent(level, event, fields));
	if (level === "error") {
		console.error(line);
		return;
	}
	if (level === "warn") {
		console.warn(line);
		return;
	}
	console.info(line);
}

export function operationalLevelForStatus(
	status: number,
): OperationalLogLevel {
	if (status >= 500) {
		return "error";
	}
	if (status >= 400) {
		return "warn";
	}
	return "info";
}
