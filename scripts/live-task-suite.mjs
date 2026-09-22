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
	assert.equal(stopped.details?.backup?.retained?.include_history, false);
	const cancelledSearch = await request("GET", "/api/v1/tasks", {
		...auth,
		query: {
			kind: "backup",
			backup_include_history: false,
			cancel_requested: true,
			terminal: true,
			terminal_reason: "cancel_requested",
			include_total: false,
			limit: 250,
		},
	});
	assert.ok(cancelledSearch.data.some((task) => task.id === stopped.id));
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

export async function verifyTaskDiscovery({
	request,
	auth,
	completedBackup,
	classId,
}) {
	assert.equal(
		completedBackup.details?.backup?.retained?.include_history,
		false,
	);
	assert.equal(
		completedBackup.details?.backup?.retained?.output_state,
		"available",
	);
	const outputSearch = await request("GET", "/api/v1/tasks", {
		...auth,
		query: {
			kind: "backup",
			backup_include_history: false,
			output_state: "available",
			terminal: true,
			status: "succeeded",
			include_total: false,
			limit: 250,
		},
	});
	assert.ok(outputSearch.data.some((task) => task.id === completedBackup.id));
	assert.equal(outputSearch.headers.get("x-total-count"), null);
	const seen = new Set();
	let cursor;
	do {
		const page = await request("GET", "/api/v1/tasks", {
			...auth,
			query: {
				kind: "backup",
				backup_include_history: false,
				include_total: false,
				sort: "created_at.desc,id.desc",
				limit: 1,
				cursor,
			},
		});
		for (const task of page.data) {
			assert.equal(task.kind, "backup");
			assert.equal(task.details?.backup?.retained?.include_history, false);
			assert.ok(!seen.has(task.id), "Cursor pagination repeated a task");
			seen.add(task.id);
		}
		cursor = page.headers.get("x-next-cursor");
		assert.ok(seen.size < 100, "Task pagination did not terminate");
	} while (cursor);
	assert.ok(seen.has(completedBackup.id));
	assert.ok(
		seen.size >= 2,
		"Expected completed and cancelled backup tasks on separate pages",
	);
	const rebuildSearch = await request("GET", "/api/v1/tasks", {
		...auth,
		query: { class_id: classId, kind: "reindex", include_total: false },
	});
	assert.ok(rebuildSearch.data.length > 0);
	assert.ok(
		rebuildSearch.data.every(
			(task) => task.details?.reindex?.class_id === classId,
		),
	);
	for (const query of [
		{ relation_id: 1 },
		{ schema_revision: 1 },
		{ terminal: true, status: "running" },
		{ kind: "import", class_id: classId },
	]) {
		await request("GET", "/api/v1/tasks", { ...auth, query, expected: 400 });
	}
}
