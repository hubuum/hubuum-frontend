import { describe, expect, it } from "vitest";

import {
	getObjectCreateLabel,
	getObjectCreationLabel,
} from "@/lib/object-create-label";

describe("getObjectCreateLabel", () => {
	it("singularizes common plural class names", () => {
		expect(getObjectCreateLabel("hosts")).toBe("New host");
		expect(getObjectCreateLabel("Rooms")).toBe("New Room");
		expect(getObjectCreateLabel("Categories")).toBe("New Category");
		expect(getObjectCreateLabel("Network classes")).toBe(
			"New Network class",
		);
	});

	it("handles irregular and uncountable class names", () => {
		expect(getObjectCreateLabel("People")).toBe("New Person");
		expect(getObjectCreateLabel("Statuses")).toBe("New Status");
		expect(getObjectCreateLabel("Series")).toBe("New Series");
		expect(getObjectCreateLabel("STATUS")).toBe("New STATUS");
	});

	it("falls back safely when no class name is available", () => {
		expect(getObjectCreateLabel(null)).toBe("New object");
		expect(getObjectCreateLabel("  ")).toBe("New object");
	});

	it("uses the same singular term for the creation dialog", () => {
		expect(getObjectCreationLabel("Hosts")).toBe("Create Host");
		expect(getObjectCreationLabel("Rooms")).toBe("Create Room");
		expect(getObjectCreationLabel(undefined)).toBe("Create object");
	});
});
