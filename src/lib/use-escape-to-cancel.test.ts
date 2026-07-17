import { describe, expect, it } from "vitest";
import {
	EscapeCancelStack,
	shouldCancelWithEscape,
} from "@/lib/use-escape-to-cancel";

function keyState(
	overrides: Partial<Parameters<typeof shouldCancelWithEscape>[0]> = {},
) {
	return {
		defaultPrevented: false,
		isComposing: false,
		key: "Escape",
		repeat: false,
		...overrides,
	};
}

describe("shouldCancelWithEscape", () => {
	it("accepts a fresh, unhandled Escape key", () => {
		expect(shouldCancelWithEscape(keyState())).toBe(true);
	});

	it.each([
		["another key", { key: "Enter" }],
		["an already handled event", { defaultPrevented: true }],
		["text composition", { isComposing: true }],
		["a held key repeat", { repeat: true }],
	])("ignores %s", (_label, overrides) => {
		expect(shouldCancelWithEscape(keyState(overrides))).toBe(false);
	});
});

describe("EscapeCancelStack", () => {
	it("keeps the most recently added interaction current", () => {
		const stack = new EscapeCancelStack<string>();
		const removeOuter = stack.add("outer editor");
		const removeInner = stack.add("inner editor");

		expect(stack.current).toBe("inner editor");
		removeInner();
		expect(stack.current).toBe("outer editor");
		removeOuter();
		expect(stack.current).toBeUndefined();
		expect(stack.hasActiveEntry).toBe(false);
	});

	it("can remove a background interaction without disturbing the current one", () => {
		const stack = new EscapeCancelStack<string>();
		const removeOuter = stack.add("outer editor");
		stack.add("inner editor");

		removeOuter();
		removeOuter();
		expect(stack.current).toBe("inner editor");
	});
});
