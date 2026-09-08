import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveApplicationVersion } from "@/lib/build-version";

describe("application build version", () => {
	let cwd: string;
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	const resolve = (configuredVersion?: string) =>
		resolveApplicationVersion({
			cwd,
			packageVersion: "1.2.3",
			configuredVersion,
		});

	beforeEach(() => {
		cwd = mkdtempSync(join(tmpdir(), "hubuum-build-version-"));
		git("init");
		git("config", "user.name", "Version test");
		git("config", "user.email", "version@example.invalid");
		git("config", "commit.gpgsign", "false");
		writeFileSync(join(cwd, "tracked.txt"), "release\n");
		git("add", ".");
		git("commit", "-m", "Release");
	});
	afterEach(() => rmSync(cwd, { recursive: true, force: true }));

	it.each([false, true])(
		"uses an exact clean release tag (annotated: %s)",
		(annotated) => {
			git("tag", ...(annotated ? ["-a", "-m", "Release"] : []), "v1.2.3");
			expect(resolve()).toBe("v1.2.3");
		},
	);

	it("counts commits since the release and includes the current commit", () => {
		git("tag", "v1.2.3");
		git("commit", "--allow-empty", "-m", "First change");
		git("commit", "--allow-empty", "-m", "Second change");
		git("tag", "unrelated-tag");
		expect(resolve()).toBe(`v1.2.3-2-g${git("rev-parse", "--short", "HEAD")}`);
	});

	it("marks tracked changes dirty, including at an exact release", () => {
		git("tag", "v1.2.3");
		writeFileSync(join(cwd, "tracked.txt"), "local change\n");
		expect(resolve()).toBe("v1.2.3-dirty");
		git("add", ".");
		expect(resolve()).toBe("v1.2.3-dirty");
		git("commit", "-m", "Change");
		writeFileSync(join(cwd, "tracked.txt"), "another change\n");
		expect(resolve()).toBe(
			`v1.2.3-1-g${git("rev-parse", "--short", "HEAD")}-dirty`,
		);
	});

	it("follows git describe by ignoring untracked files", () => {
		git("tag", "v1.2.3");
		writeFileSync(join(cwd, "untracked.txt"), "local notes\n");
		expect(resolve()).toBe("v1.2.3");
	});

	it("uses the commit when no release tag is reachable", () => {
		expect(resolve()).toBe(git("rev-parse", "--short", "HEAD"));
	});

	it("reports missing Git metadata without claiming the source is dirty", () => {
		rmSync(join(cwd, ".git"), { recursive: true, force: true });
		expect(resolve()).toBe("v1.2.3+unknown");
	});

	it("preserves an explicit immutable build identity", () => {
		expect(resolve("  v1.2.3-4-gabcdef0  ")).toBe("v1.2.3-4-gabcdef0");
		expect(resolve("v0.0.0+visual")).toBe("v0.0.0+visual");
		git("tag", "v1.2.3");
		expect(resolve("  ")).toBe("v1.2.3");
	});
});
