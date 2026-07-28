import { describe, expect, it } from "vitest";

import { ServerTiming } from "@/lib/server-timing";

describe("server timing", () => {
	it("aggregates repeated phases and attaches a standards-based header", async () => {
		const clockValues = [10, 11.25, 20, 22.75, 30, 34.5];
		const timing = new ServerTiming(() => clockValues.shift() ?? 0);

		await timing.measure("validation", async () => undefined);
		await timing.measure("validation", async () => undefined);
		const finishTotal = timing.start("total");
		finishTotal();
		finishTotal();

		const response = timing.attach(new Response("report"));

		expect(response.headers.get("Server-Timing")).toBe(
			'total;dur=4.5;desc="Total to headers", validation;dur=4.0;desc="Task validation"',
		);
	});

	it("ignores invalid durations", () => {
		const timing = new ServerTiming();
		timing.add("cache", Number.NaN);
		timing.add("output", -1);

		expect(timing.toHeaderValue()).toBe("");
	});
});
