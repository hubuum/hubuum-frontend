export type DataHeadingColumn = {
	id: string;
	label: string;
	paths: string[][];
	source: "data" | "custom";
};

export type DataColumnHeading = {
	context: string;
	label: string;
};

const DATA_HEADING_ACRONYMS: Record<string, string> = {
	api: "API",
	cpu: "CPU",
	dns: "DNS",
	id: "ID",
	ip: "IP",
	ipv4: "IPv4",
	ipv6: "IPv6",
	mac: "MAC",
	os: "OS",
	ram: "RAM",
	url: "URL",
	uuid: "UUID",
};

type HeadingCandidate = {
	id: string;
	tokens: string[];
	depth: number;
	fallbackLabel: string;
	dynamic: boolean;
};

function humanizeDataPathSegment(segment: string): string {
	const arrayIndex = segment.match(/^\[(\d+)]$/);
	if (arrayIndex) {
		return `Item ${Number.parseInt(arrayIndex[1], 10) + 1}`;
	}

	return segment
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.replaceAll("-", " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			const acronym = DATA_HEADING_ACRONYMS[word.toLowerCase()];
			return acronym ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
		})
		.join(" ");
}

function singularizeHeading(value: string): string {
	const normalizedValue = value.toLowerCase();
	if (
		/^[A-Z0-9]+$/.test(value) ||
		["news", "series", "species"].includes(normalizedValue)
	) {
		return value;
	}
	if (value.endsWith("ies")) {
		return `${value.slice(0, -3)}y`;
	}
	if (/(sses|shes|ches|xes|zes)$/i.test(value)) {
		return value.slice(0, -2);
	}
	if (value.endsWith("s") && !/(ss|us|is|ses)$/i.test(value)) {
		return value.slice(0, -1);
	}
	return value;
}

function getPathTokens(path: string[]): string[] {
	const tokens: string[] = [];
	for (const segment of path) {
		const arrayIndex = segment.match(/^\[(\d+)]$/);
		if (arrayIndex && tokens.length > 0) {
			const parent = singularizeHeading(tokens.pop() ?? "Item");
			tokens.push(`${parent} ${Number.parseInt(arrayIndex[1], 10) + 1}`);
			continue;
		}
		tokens.push(humanizeDataPathSegment(segment));
	}
	return tokens;
}

function normalizeHeading(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getVisibleLabel(candidate: HeadingCandidate): string {
	return candidate.tokens.slice(-candidate.depth).join(" · ");
}

function getCollisionGroups(candidates: HeadingCandidate[]) {
	const groups = new Map<string, HeadingCandidate[]>();
	for (const candidate of candidates) {
		const key = normalizeHeading(getVisibleLabel(candidate));
		const group = groups.get(key) ?? [];
		group.push(candidate);
		groups.set(key, group);
	}
	return [...groups.values()].filter((group) => group.length > 1);
}

function toHeadingCandidate(column: DataHeadingColumn): HeadingCandidate {
	if (column.source === "custom") {
		return {
			id: column.id,
			tokens: ["Custom field", column.label],
			depth: 1,
			fallbackLabel: `Custom field · ${column.label}`,
			dynamic: true,
		};
	}

	const path = column.paths[0] ?? [];
	const tokens = path.length > 0 ? getPathTokens(path) : [column.label];

	return {
		id: column.id,
		tokens,
		depth: 1,
		fallbackLabel: column.label,
		dynamic: true,
	};
}

/**
 * Builds compact labels for the currently visible data columns. Every heading
 * starts at its leaf key and only gains parent segments while it collides with
 * another visible heading.
 */
export function getDataColumnHeadings(
	columns: DataHeadingColumn[],
	reservedLabels: string[] = [],
): Map<string, DataColumnHeading> {
	const dynamicCandidates = columns.map(toHeadingCandidate);
	const reservedCandidates = reservedLabels.map<HeadingCandidate>(
		(label, index) => ({
			id: `reserved:${index}:${label}`,
			tokens: [label],
			depth: 1,
			fallbackLabel: label,
			dynamic: false,
		}),
	);
	const candidates = [...dynamicCandidates, ...reservedCandidates];

	let changed = true;
	while (changed) {
		changed = false;
		for (const group of getCollisionGroups(candidates)) {
			for (const candidate of group) {
				if (candidate.dynamic && candidate.depth < candidate.tokens.length) {
					candidate.depth += 1;
					changed = true;
				}
			}
		}
	}

	const unresolvedCandidateIds = new Set(
		getCollisionGroups(candidates).flatMap((group) =>
			group
				.filter((candidate) => candidate.dynamic)
				.map((candidate) => candidate.id),
		),
	);
	const usedLabels = new Set(
		candidates
			.filter((candidate) => !unresolvedCandidateIds.has(candidate.id))
			.map((candidate) => normalizeHeading(getVisibleLabel(candidate))),
	);
	const forcedLabels = new Map<string, string>();
	for (const candidate of dynamicCandidates) {
		if (!unresolvedCandidateIds.has(candidate.id)) {
			continue;
		}

		let fallbackLabel = candidate.fallbackLabel;
		let suffix = 1;
		while (usedLabels.has(normalizeHeading(fallbackLabel))) {
			fallbackLabel = `${candidate.fallbackLabel} · ${suffix}`;
			suffix += 1;
		}
		forcedLabels.set(candidate.id, fallbackLabel);
		usedLabels.add(normalizeHeading(fallbackLabel));
	}

	return new Map(
		dynamicCandidates.map((candidate) => {
			const forcedLabel = forcedLabels.get(candidate.id);
			if (forcedLabel) {
				return [candidate.id, { context: "", label: forcedLabel }];
			}

			const visibleTokens = candidate.tokens.slice(-candidate.depth);
			return [
				candidate.id,
				{
					context: visibleTokens.slice(0, -1).join(" · "),
					label: visibleTokens.at(-1) ?? candidate.fallbackLabel,
				},
			];
		}),
	);
}
