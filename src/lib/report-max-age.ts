const MAX_REPORT_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export type ReportMaxAgeResult =
	| {
			maxAgeMilliseconds: number | null;
			ok: true;
	  }
	| {
			message: string;
			ok: false;
	  };

export function parseReportMaxAge(raw: string | null): ReportMaxAgeResult {
	if (raw === null || !raw.trim()) {
		return {
			maxAgeMilliseconds: null,
			ok: true,
		};
	}

	const match = /^(\d+)([smhd]?)$/i.exec(raw.trim());
	if (!match) {
		return {
			message:
				"Maximum age must be 0 or a whole-number duration such as 30s, 15m, 2h, or 1d.",
			ok: false,
		};
	}

	const amount = Number.parseInt(match[1], 10);
	const unit = match[2].toLowerCase();
	const multiplier =
		unit === "d"
			? 24 * 60 * 60 * 1000
			: unit === "h"
				? 60 * 60 * 1000
				: unit === "m"
					? 60 * 1000
					: 1000;
	const maxAgeMilliseconds = amount * multiplier;
	if (
		!Number.isSafeInteger(maxAgeMilliseconds) ||
		maxAgeMilliseconds > MAX_REPORT_AGE_MS
	) {
		return {
			message: "Maximum age cannot exceed 365d.",
			ok: false,
		};
	}

	return {
		maxAgeMilliseconds,
		ok: true,
	};
}
