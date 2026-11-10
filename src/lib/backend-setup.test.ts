import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	normalizeBackendOrigin,
	SUPPORTED_SERVER_VERSION,
	verifyBackendInstallation,
} from "@/lib/backend-setup";

const document = JSON.parse(
	readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"),
);
const config = {
	authentication: {
		session_access_seconds: 300,
		session_idle_seconds: 3600,
		session_absolute_seconds: 28800,
	},
	pagination: { default_page_limit: 50, max_page_limit: 250 },
};

describe("backend setup discovery", () => {
	it.each([
		["https://hubuum.example.com/", "https://hubuum.example.com"],
		[" http://hubuum:8080 ", "http://hubuum:8080"],
		["http://[::1]:8080", "http://[::1]:8080"],
	])("normalizes a deployment origin: %s", (input, expected) => {
		expect(normalizeBackendOrigin(input)).toBe(expected);
	});
	it.each([
		"",
		"hubuum.example.com",
		"ftp://hubuum",
		"file:///tmp/server",
		"https://user:secret@hubuum",
		"https://hubuum/api/v1",
		"https://hubuum?secret=value",
		"https://hubuum/#token",
	])("rejects non-origin URLs: %s", (input) => {
		expect(() => normalizeBackendOrigin(input)).toThrow();
	});
	it("recognizes the bundled contract and keeps the supported release aligned", () => {
		expect(document.info.version).toBe(SUPPORTED_SERVER_VERSION);
		expect(verifyBackendInstallation(document, config)).toBe(
			SUPPORTED_SERVER_VERSION,
		);
	});
	it.each(["v0.0.22", "0.0.22+build.123"])(
		"accepts release labels and build metadata: %s",
		(version) => {
			expect(
				verifyBackendInstallation(
					{ ...document, info: { ...document.info, version } },
					config,
				),
			).toBe(version);
		},
	);
	it.each([
		"0.0.21",
		"0.0.23",
		"1.0.0",
		"0.0.22-rc.1",
		"v0.0.22-5-gabcdef",
		"main",
		"0.0.22-dirty",
	])("rejects unsupported or unverified versions: %s", (version) => {
		expect(() =>
			verifyBackendInstallation(
				{ ...document, info: { ...document.info, version } },
				config,
			),
		).toThrow("not supported");
	});
	it.each([
		null,
		{},
		{ ...document, info: { ...document.info, title: "Another API" } },
		{ ...document, paths: {} },
	])("rejects unrelated or incomplete installations", (candidate) => {
		expect(() => verifyBackendInstallation(candidate, config)).toThrow(
			"Hubuum API",
		);
	});
	it.each([null, {}, { ...config, pagination: {} }])(
		"requires working public configuration",
		(candidate) => {
			expect(() => verifyBackendInstallation(document, candidate)).toThrow(
				"public configuration",
			);
		},
	);
});
