import assert from "node:assert/strict";

export async function verifyFieldDiscoveryAndSuggestions({
	request,
	waitFor,
	auth,
	readerToken,
	collectionId,
	suffix,
}) {
	const created = await request("POST", "/api/v1/classes", {
		...auth,
		expected: 201,
		body: {
			name: `discovery_${suffix}`,
			description: "Field discovery contract",
			collection_id: collectionId,
			json_schema: null,
			validate_schema: false,
		},
	});
	const classId = created.data.id;
	const path = `/api/v1/classes/${classId}`;
	const data = {
		hostname: "host",
		"a.b": true,
		a: { b: 7 },
		"[#]": "literal",
		addresses: [{ ip: "192.0.2.1" }, { ip: "192.0.2.2" }],
	};
	await request("POST", `${path}/`, {
		...auth,
		expected: 201,
		body: {
			name: `discovery_object_${suffix}`,
			description: "Structured paths",
			collection_id: collectionId,
			hubuum_class_id: classId,
			data,
		},
	});
	const reader = { token: readerToken };
	const inventory = (
		await request("GET", `${path}/fields`, {
			...reader,
			query: { limit: 100, depth: 6, containers: true },
		})
	).data;
	assert.equal(inventory.sampled, true);
	assert.equal(inventory.sampled_objects, 1);
	const byName = (
		await request(
			"GET",
			`/api/v1/classes/by-name/${created.data.name}/fields`,
			{
				...reader,
				query: { limit: 100, depth: 6, containers: true },
			},
		)
	).data;
	assert.deepEqual(byName, inventory);
	assert.ok(
		inventory.fields.some(
			(field) =>
				JSON.stringify(field.path) ===
				JSON.stringify([{ kind: "property", name: "a.b" }]),
		),
	);
	assert.ok(
		inventory.fields.some(
			(field) =>
				JSON.stringify(field.path) ===
				JSON.stringify([
					{ kind: "property", name: "a" },
					{ kind: "property", name: "b" },
				]),
		),
	);
	const address = inventory.fields.find(
		(field) =>
			JSON.stringify(field.path) ===
			JSON.stringify([
				{ kind: "property", name: "addresses" },
				{ kind: "array_item" },
				{ kind: "property", name: "ip" },
			]),
	);
	assert.equal(address?.object_count, 1);
	assert.equal(address?.observation_count, 2);
	await request("GET", `${path}/fields`, {
		...reader,
		query: { limit: 251 },
		expected: 400,
	});
	const activeBefore = (await request("GET", `${path}/schema`, auth)).data
		.active.revision;
	for (const preset of ["strict", "balanced", "expansive"]) {
		const queued = (
			await request("POST", `${path}/schema/profiles`, {
				...reader,
				expected: 202,
				body: { preset, sample_limit: 100 },
			})
		).data;
		assert.equal(queued.kind, "schema_profiling");
		assert.equal(queued.details.schema_profiling.class_id, classId);
		await waitFor(
			"schema profiling",
			async () => {
				const task = (
					await request("GET", `/api/v1/tasks/${queued.id}`, reader)
				).data;
				assert.ok(
					!["failed", "cancelled", "partially_succeeded"].includes(task.status),
					task.status,
				);
				return task.status === "succeeded" ? task : null;
			},
			{ attempts: 120, intervalMs: 250 },
		);
		const report = (
			await request("GET", `${path}/schema/profiles/${queued.id}`, reader)
		).data;
		assert.equal(report.status, "candidate");
		assert.equal(report.sample_valid, true);
		assert.equal(report.options.preset, preset);
		assert.equal(
			(await request("GET", `${path}/schema`, auth)).data.active.revision,
			activeBefore,
		);
		if (preset !== "balanced") continue;
		const revision = (
			await request("POST", `${path}/schema/revisions`, {
				...auth,
				expected: 201,
				body: { json_schema: report.schema, validate_schema: true },
			})
		).data;
		const impact = (
			await request(
				"POST",
				`${path}/schema/revisions/${revision.revision}/impact`,
				{ ...auth, expected: 202 },
			)
		).data;
		const checked = await waitFor(
			"suggestion impact",
			async () => {
				const work = (
					await request("GET", `${path}/schema/tasks/${impact.task_id}`, auth)
				).data;
				assert.notEqual(work.status, "failed");
				return work.status === "complete" ? work : null;
			},
			{ attempts: 120, intervalMs: 250 },
		);
		assert.equal(checked.readiness, "compatible");
		// Keep the active policy unchanged until every profiling preset is verified.
		created.suggestionRevision = revision.revision;
		created.suggestionImpact = checked.task_id;
	}
	const activation = (
		await request(
			"POST",
			`${path}/schema/revisions/${created.suggestionRevision}/activate`,
			{
				...auth,
				body: {
					expected_active_revision: activeBefore,
					policy: "reject_incompatible",
					impact_task_id: created.suggestionImpact,
				},
			},
		)
	).data;
	assert.equal(activation.active.revision, created.suggestionRevision);
}
