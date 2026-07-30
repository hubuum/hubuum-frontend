import "server-only";

import {
	readFile,
	readdir,
	realpath,
	stat,
} from "node:fs/promises";
import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	sep,
} from "node:path";

const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
const CONTENT_TYPES = new Map([
	[".avif", "image/avif"],
	[".jpeg", "image/jpeg"],
	[".jpg", "image/jpeg"],
	[".png", "image/png"],
	[".webp", "image/webp"],
]);

export type MountedLoginBackground = {
	id: string;
	label: string;
	url: string;
};

export type MountedLoginBackgroundFile = {
	bytes: Uint8Array<ArrayBuffer>;
	contentType: string;
	etag: string;
	lastModified: string;
};

export function getLoginBackgroundsDirectory(): string {
	return join(process.cwd(), "login-backgrounds");
}

export function isSupportedLoginBackgroundFilename(filename: string): boolean {
	return (
		filename.length > 0 &&
		filename.length <= 240 &&
		filename === basename(filename) &&
		filename !== "." &&
		filename !== ".." &&
		!filename.startsWith(".") &&
		!filename.includes("\0") &&
		CONTENT_TYPES.has(extname(filename).toLowerCase())
	);
}

export function getMountedLoginBackgroundId(filename: string): string {
	return `mounted:${encodeURIComponent(filename)}`;
}

export function getMountedLoginBackgroundLabel(filename: string): string {
	const stem = filename.slice(0, -extname(filename).length);
	const words = stem
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.split(" ");

	return words
		.map((word) =>
			word.length > 0 ? `${word[0].toLocaleUpperCase()}${word.slice(1)}` : "",
		)
		.join(" ");
}

export async function listMountedLoginBackgrounds(
	directory = getLoginBackgroundsDirectory(),
): Promise<MountedLoginBackground[]> {
	try {
		const entries = await readdir(/*turbopackIgnore: true*/ directory, {
			withFileTypes: true,
		});
		return entries
			.filter(
				(entry) =>
					entry.isFile() && isSupportedLoginBackgroundFilename(entry.name),
			)
			.sort((left, right) =>
				left.name.localeCompare(right.name, "en", {
					numeric: true,
					sensitivity: "base",
				}),
			)
			.map((entry) => ({
				id: getMountedLoginBackgroundId(entry.name),
				label: getMountedLoginBackgroundLabel(entry.name),
				url: `/login-backgrounds/custom/${encodeURIComponent(entry.name)}`,
			}));
	} catch {
		return [];
	}
}

export async function readMountedLoginBackground(
	filename: string,
	directory = getLoginBackgroundsDirectory(),
): Promise<MountedLoginBackgroundFile | null> {
	if (!isSupportedLoginBackgroundFilename(filename)) {
		return null;
	}

	try {
		const entries = await readdir(/*turbopackIgnore: true*/ directory, {
			withFileTypes: true,
		});
		const entry = entries.find(
			(candidate) => candidate.isFile() && candidate.name === filename,
		);
		if (!entry) {
			return null;
		}

		const directoryPath = await realpath(
			/*turbopackIgnore: true*/ directory,
		);
		const filePath = await realpath(
			/*turbopackIgnore: true*/ join(directoryPath, entry.name),
		);
		const relativePath = relative(directoryPath, filePath);
		if (
			relativePath.length === 0 ||
			relativePath === ".." ||
			relativePath.startsWith(`..${sep}`) ||
			isAbsolute(relativePath)
		) {
			return null;
		}

		const fileStat = await stat(/*turbopackIgnore: true*/ filePath);
		if (
			!fileStat.isFile() ||
			fileStat.size === 0 ||
			fileStat.size > MAX_BACKGROUND_BYTES
		) {
			return null;
		}

		const bytes = Uint8Array.from(
			await readFile(/*turbopackIgnore: true*/ filePath),
		);
		const contentType = CONTENT_TYPES.get(extname(filename).toLowerCase());
		if (!contentType) {
			return null;
		}

		return {
			bytes,
			contentType,
			etag: `"${fileStat.size.toString(16)}-${Math.trunc(fileStat.mtimeMs).toString(16)}"`,
			lastModified: fileStat.mtime.toUTCString(),
		};
	} catch {
		return null;
	}
}
