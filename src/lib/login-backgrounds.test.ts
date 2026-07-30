import {
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	getMountedLoginBackgroundId,
	getMountedLoginBackgroundLabel,
	isSupportedLoginBackgroundFilename,
	listMountedLoginBackgrounds,
	readMountedLoginBackground,
} from "@/lib/login-backgrounds";

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "hubuum-login-backgrounds-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("mounted login backgrounds", () => {
	it("validates names and produces stable public metadata", () => {
		expect(isSupportedLoginBackgroundFilename("sample image.webp")).toBe(true);
		expect(isSupportedLoginBackgroundFilename("ridge.JPEG")).toBe(true);
		expect(isSupportedLoginBackgroundFilename("../private.webp")).toBe(false);
		expect(isSupportedLoginBackgroundFilename(".hidden.webp")).toBe(false);
		expect(isSupportedLoginBackgroundFilename("notes.txt")).toBe(false);
		expect(getMountedLoginBackgroundId("sample image.webp")).toBe(
			"mounted:sample%20image.webp",
		);
		expect(getMountedLoginBackgroundLabel("sample-image_2.webp")).toBe(
			"Sample Image 2",
		);
	});

	it("lists only supported regular files", async () => {
		const directory = await makeTemporaryDirectory();
		await writeFile(join(directory, "ridge.JPG"), "jpeg");
		await writeFile(join(directory, "sample-image.webp"), "webp");
		await writeFile(join(directory, "notes.txt"), "not an image");
		await symlink(
			join(directory, "sample-image.webp"),
			join(directory, "linked.webp"),
		);

		await expect(listMountedLoginBackgrounds(directory)).resolves.toEqual([
			{
				id: "mounted:ridge.JPG",
				label: "Ridge",
				url: "/login-backgrounds/custom/ridge.JPG",
			},
			{
				id: "mounted:sample-image.webp",
				label: "Sample Image",
				url: "/login-backgrounds/custom/sample-image.webp",
			},
		]);
	});

	it("reads a bounded image without allowing traversal or symlinks", async () => {
		const directory = await makeTemporaryDirectory();
		await writeFile(join(directory, "private.webp"), "private image");
		await symlink(
			join(directory, "private.webp"),
			join(directory, "linked.webp"),
		);

		const image = await readMountedLoginBackground("private.webp", directory);
		expect(new TextDecoder().decode(image?.bytes)).toBe("private image");
		expect(image?.contentType).toBe("image/webp");
		expect(image?.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
		await expect(
			readMountedLoginBackground("../private.webp", directory),
		).resolves.toBeNull();
		await expect(
			readMountedLoginBackground("linked.webp", directory),
		).resolves.toBeNull();
	});
});
