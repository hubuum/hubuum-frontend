const UNCOUNTABLE_NOUNS = new Set([
	"data",
	"equipment",
	"information",
	"news",
	"series",
	"species",
	"status",
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
	analyses: "analysis",
	children: "child",
	feet: "foot",
	geese: "goose",
	indices: "index",
	matrices: "matrix",
	men: "man",
	mice: "mouse",
	people: "person",
	statuses: "status",
	teeth: "tooth",
	women: "woman",
};

function preserveWordCase(source: string, value: string): string {
	if (source === source.toUpperCase()) return value.toUpperCase();
	if (source[0] === source[0]?.toUpperCase()) {
		return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
	}
	return value;
}

function singularizeWord(word: string): string {
	const normalized = word.toLowerCase();
	if (UNCOUNTABLE_NOUNS.has(normalized)) return word;

	const irregular = IRREGULAR_SINGULARS[normalized];
	if (irregular) return preserveWordCase(word, irregular);

	let singular = normalized;
	if (normalized.endsWith("ies") && normalized.length > 3) {
		singular = `${normalized.slice(0, -3)}y`;
	} else if (/(sses|shes|ches|xes|zes)$/.test(normalized)) {
		singular = normalized.slice(0, -2);
	} else if (normalized.endsWith("s") && !/(ss|us|is)$/.test(normalized)) {
		singular = normalized.slice(0, -1);
	}

	return preserveWordCase(word, singular);
}

export function getSingularObjectClassName(
	className: string | null | undefined,
): string | null {
	const normalizedName = className?.trim();
	if (!normalizedName) return null;

	const trailingWord = normalizedName.match(/^(.*?)([A-Za-z]+)$/);
	if (!trailingWord) return normalizedName;

	return `${trailingWord[1]}${singularizeWord(trailingWord[2])}`;
}

export function getObjectCreateLabel(className: string | null | undefined) {
	const singularName = getSingularObjectClassName(className);
	return singularName ? `New ${singularName}` : "New object";
}

export function getObjectCreationLabel(className: string | null | undefined) {
	const singularName = getSingularObjectClassName(className);
	return singularName ? `Create ${singularName}` : "Create object";
}
