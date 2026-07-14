import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineFieldEditTrigger } from "@/components/inline-field-edit-trigger";

describe("InlineFieldEditTrigger", () => {
	it("renders the whole value as an accessible edit target without an icon", () => {
		const markup = renderToStaticMarkup(
			createElement(
				InlineFieldEditTrigger,
				{
					fieldLabel: "object name",
					onClick: () => undefined,
					valueText: "server-01",
				},
				"server-01",
			),
		);

		expect(markup).toContain('class="inline-field-edit-trigger"');
		expect(markup).toContain(
			'aria-label="Edit object name. Current value: server-01"',
		);
		expect(markup).toContain(">server-01</span>");
		expect(markup).not.toContain("<svg");
	});
});
