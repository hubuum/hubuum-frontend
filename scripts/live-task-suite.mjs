import assert from "node:assert/strict";

export async function verifyTaskCancellation({
	request,
	waitFor,
	auth,
	readerToken,
}) {
	const terminal = (task) =>
		["succeeded", "failed", "partially_succeeded", "cancelled"].includes(
			task.status,
		);
	let stopped;
	// A small backup can finish before the request arrives; completed work must stay completed.
	for (let attempt = 0; attempt < 5 && !stopped; attempt += 1) {
		const submitted = await request("POST", "/api/v1/backups", {
			...auth,
			body: { include_history: false },
			expected: 202,
		});
		const path = `/api/v1/tasks/${submitted.data.id}`;
		const requested = await request("POST", `${path}/cancel`, {
			...auth,
			body: { reason: "Compatibility cancellation check" },
			expected: [200, 202],
		});
		if (requested.status === 202) {
			assert.ok(!terminal(requested.data));
			assert.ok(requested.data.cancel_requested_at);
		}
		const finished = await waitFor(
			"task cancellation acknowledgement",
			async () => {
				const result = (await request("GET", path, auth)).data;
				return terminal(result) ? result : null;
			},
			{ attempts: 120, intervalMs: 250 },
		);
		const repeated = await request("POST", `${path}/cancel`, {
			...auth,
			body: {
				reason: "Must not replace the first reason",
				expected_status: "queued",
			},
		});
		for (const key of [
			"status",
			"cancel_reason",
			"cancel_requested_by",
			"cancel_requested_at",
			"terminal_reason",
			"finished_at",
		]) {
			assert.deepEqual(repeated.data[key], finished[key]);
		}
		if (finished.status === "cancelled") stopped = finished;
	}
	assert.ok(
		stopped,
		"No cancellation was acknowledged before backup completion.",
	);
	assert.equal(stopped.terminal_reason, "cancel_requested");
	assert.equal(stopped.cancel_reason, "Compatibility cancellation check");
	assert.ok(Number.isInteger(stopped.cancel_requested_by));
	assert.ok(Number.isInteger(stopped.unattempted_items));
	assert.equal(stopped.details?.backup?.output_available, false);
	const path = `/api/v1/tasks/${stopped.id}`;
	await request("POST", `${path}/cancel`, {
		token: readerToken,
		body: {},
		expected: [403, 404],
	});
	for (const body of [
		{ reason: "ø".repeat(257) },
		{ reason: "line\nbreak" },
		{ reason: " " },
		{ timeout: 5 },
	]) {
		await request("POST", `${path}/cancel`, { ...auth, body, expected: 400 });
	}
	const events = await request("GET", `${path}/events`, {
		...auth,
		query: { include_total: false, limit: 250 },
	});
	assert.equal(
		events.data.filter((event) => event.event_type === "cancel_requested")
			.length,
		1,
	);
}
