import assert from "node:assert/strict";
import { expect } from "@playwright/test";

/** Shared fixture UI only: no IdP protocol is implemented by the client. */
export async function approveProvider(
	owner,
	input,
	decision = "Approve",
	onPopup = () => {},
) {
	const region = owner.getByRole("region", { name: "Browser authentication" });
	const code = await region.locator("code").textContent();
	assert(code);
	const popupEvent = owner.waitForEvent("popup");
	await region.getByRole("link", { name: "Open authentication page" }).click();
	const popup = await popupEvent;
	onPopup(popup);
	await popup.waitForLoadState("domcontentloaded");
	assert.equal(await popup.evaluate(() => window.opener === null), true);
	assert.equal(new URL(popup.url()).origin, input.serverOrigin);
	await popup.getByLabel("Verification code", { exact: true }).fill(code);
	await popup.getByRole("button", { name: "Continue", exact: true }).click();
	await popup.getByRole("button", { name: "Continue", exact: true }).click();
	await popup
		.getByRole("link", { name: "Continue to sign in", exact: true })
		.click();
	if (input.profile !== "oauth") {
		await expect(popup.locator("#password")).toBeVisible();
		const username = popup.locator("#username");
		if (
			(await username.count()) &&
			(await username.isVisible()) &&
			(await username.isEditable())
		)
			await username.fill(input.username);
		await popup.locator("#password").fill(input.password);
		await popup.locator("#kc-login").click();
	}
	await expect(
		popup.getByRole("heading", { name: "Approve this request?", exact: true }),
	).toBeVisible();
	await popup.getByRole("button", { name: decision, exact: true }).click();
	return popup;
}
