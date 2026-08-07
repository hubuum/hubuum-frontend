import { describe, expect, it } from "vitest";

import { getPasswordConfirmationError } from "@/lib/password-confirmation";

describe("getPasswordConfirmationError", () => {
	it("accepts two blank fields when the password is unchanged", () => {
		expect(getPasswordConfirmationError("", "")).toBeNull();
	});

	it("accepts matching new passwords", () => {
		expect(getPasswordConfirmationError("new secret", "new secret")).toBeNull();
	});

	it("rejects a missing confirmation", () => {
		expect(getPasswordConfirmationError("new secret", "")).toBe(
			"Passwords do not match.",
		);
	});

	it("rejects different passwords", () => {
		expect(getPasswordConfirmationError("new secret", "different")).toBe(
			"Passwords do not match.",
		);
	});
});
