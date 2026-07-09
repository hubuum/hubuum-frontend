import { describe, expect, it } from "vitest";
import {
	getDataColumnHeadings,
	type DataHeadingColumn,
} from "@/lib/data-column-headings";

function dataColumn(id: string, path: string[]): DataHeadingColumn {
	return {
		id,
		label: path.join("."),
		paths: [path],
		source: "data",
	};
}

function headingText(
	headings: ReturnType<typeof getDataColumnHeadings>,
	id: string,
) {
	const heading = headings.get(id);
	if (!heading) {
		throw new Error(`Missing heading for ${id}`);
	}
	return heading.context
		? `${heading.context} · ${heading.label}`
		: heading.label;
}

describe("getDataColumnHeadings", () => {
	it("uses unique leaf keys on their own", () => {
		const headings = getDataColumnHeadings([
			dataColumn("ipv4", ["network", "interfaces", "[0]", "ipv4"]),
			dataColumn("ipv6", ["network", "interfaces", "[0]", "ipv6"]),
			dataColumn("mac", ["network", "interfaces", "[0]", "mac"]),
		]);

		expect(headingText(headings, "ipv4")).toBe("IPv4");
		expect(headingText(headings, "ipv6")).toBe("IPv6");
		expect(headingText(headings, "mac")).toBe("MAC");
	});

	it("adds only enough parent context to separate duplicate leaves", () => {
		const headings = getDataColumnHeadings([
			dataColumn("billing", ["billing", "owner", "name"]),
			dataColumn("technical", ["technical", "owner", "name"]),
		]);

		expect(headingText(headings, "billing")).toBe("Billing · Owner · Name");
		expect(headingText(headings, "technical")).toBe("Technical · Owner · Name");
	});

	it("uses humanized array positions to distinguish sibling fields", () => {
		const headings = getDataColumnHeadings([
			dataColumn("first", ["network", "interfaces", "[0]", "name"]),
			dataColumn("second", ["network", "interfaces", "[1]", "name"]),
		]);

		expect(headingText(headings, "first")).toBe("Interface 1 · Name");
		expect(headingText(headings, "second")).toBe("Interface 2 · Name");
	});

	it("expands a longer suffix path until both headings are distinct", () => {
		const headings = getDataColumnHeadings([
			dataColumn("short", ["interfaces", "[0]", "name"]),
			dataColumn("long", ["network", "interfaces", "[0]", "name"]),
		]);

		expect(headingText(headings, "short")).toBe("Interface 1 · Name");
		expect(headingText(headings, "long")).toBe("Network · Interface 1 · Name");
	});

	it("treats fixed table headings as part of the current display set", () => {
		const headings = getDataColumnHeadings(
			[
				dataColumn("name", ["network", "interfaces", "[0]", "name"]),
				dataColumn("ipv4", ["network", "interfaces", "[0]", "ipv4"]),
			],
			["ID", "Name", "Collection", "Description"],
		);

		expect(headingText(headings, "name")).toBe("Interface 1 · Name");
		expect(headingText(headings, "ipv4")).toBe("IPv4");
	});

	it("returns to a bare leaf when a colliding column is removed", () => {
		const headings = getDataColumnHeadings([
			dataColumn("name", ["network", "interfaces", "[0]", "name"]),
		]);

		expect(headingText(headings, "name")).toBe("Name");
	});

	it("keeps a top-level key bare while contextualizing a nested duplicate", () => {
		const headings = getDataColumnHeadings([
			dataColumn("top-level", ["name"]),
			dataColumn("nested", ["network", "interfaces", "[0]", "name"]),
		]);

		expect(headingText(headings, "top-level")).toBe("Name");
		expect(headingText(headings, "nested")).toBe("Interface 1 · Name");
	});

	it("disambiguates custom labels from matching data keys", () => {
		const headings = getDataColumnHeadings([
			dataColumn("data-ipv4", ["network", "interfaces", "[0]", "ipv4"]),
			{
				id: "custom-ipv4",
				label: "IPv4",
				paths: [["fallback", "ipv4"]],
				source: "custom",
			},
		]);

		expect(headingText(headings, "data-ipv4")).toBe("Interface 1 · IPv4");
		expect(headingText(headings, "custom-ipv4")).toBe("Custom field · IPv4");
	});

	it("falls back to exact raw paths when humanized paths still collide", () => {
		const headings = getDataColumnHeadings([
			dataColumn("dash", ["foo-bar", "name"]),
			dataColumn("underscore", ["foo_bar", "name"]),
		]);

		expect(headingText(headings, "dash")).toBe("foo-bar.name");
		expect(headingText(headings, "underscore")).toBe("foo_bar.name");
	});

	it("keeps fallback labels unique across the complete display set", () => {
		const headings = getDataColumnHeadings([
			dataColumn("dash", ["foo-bar", "name"]),
			dataColumn("underscore", ["foo_bar", "name"]),
			{
				id: "custom-raw-path",
				label: "foo-bar.name",
				paths: [["fallback"]],
				source: "custom",
			},
		]);

		expect(headingText(headings, "dash")).toBe("foo-bar.name · 1");
		expect(headingText(headings, "underscore")).toBe("foo_bar.name");
		expect(headingText(headings, "custom-raw-path")).toBe("foo-bar.name");
	});

	it("does not corrupt non-plural array keys", () => {
		const headings = getDataColumnHeadings([
			dataColumn("status", ["status", "[0]", "name"]),
			dataColumn("series", ["series", "[0]", "name"]),
		]);

		expect(headingText(headings, "status")).toBe("Status 1 · Name");
		expect(headingText(headings, "series")).toBe("Series 1 · Name");
	});
});
