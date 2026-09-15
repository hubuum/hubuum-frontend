import assert from "node:assert/strict";

export async function verifySchemaEvolution({ request, waitFor, auth, readerToken, collectionId, suffix, hasRepairReports = false }) {
	const created = await request("POST", "/api/v1/classes", {
		...auth, expected: 201,
		body: { name: `schema_contract_${suffix}`, description: "Schema lifecycle contract", collection_id: collectionId, json_schema: null, validate_schema: false },
	});
	const classId = created.data.id;
	const path = `/api/v1/classes/${classId}`;
	const schema = `${path}/schema`;
	const initialData = hasRepairReports ? { interfaces: [{ address: "one" }, { address: "two" }, { address: "three" }, { address: 123 }] } : {};
	const object = await request("POST", `${path}/`, {
		...auth, expected: 201,
		body: { name: `schema_object_${suffix}`, description: "Before validation", collection_id: collectionId, hubuum_class_id: classId, data: initialData },
	});
	const initial = await request("GET", schema, auth);
	assert.equal(initial.data.active.revision, 1);
	assert.equal(initial.data.counts.not_required, 1);
	const policy = { json_schema: { type: "object", required: ["hostname"], properties: { hostname: { type: "string" } } }, validate_schema: true };
	if (hasRepairReports) policy.json_schema.properties.interfaces = { type: "array", items: { type: "object", properties: { address: { type: "string" } } } };
	await request("PATCH", path, { ...auth, body: policy, expected: 409 });
	const staged = await request("POST", `${schema}/revisions`, { ...auth, body: policy, expected: 201 });
	const revision = staged.data.revision;
	assert.equal(staged.data.status, "staged");
	assert.equal((await request("GET", path, auth)).data.validate_schema, false);

	async function analyze(target) {
		const queued = await request("POST", `${schema}/revisions/${target}/impact`, { ...auth, expected: 202 });
		const report = await waitFor("schema impact", async () => {
			const result = (await request("GET", `${schema}/tasks/${queued.data.task_id}`, auth)).data;
			assert.notEqual(result.status, "failed");
			return result.status === "complete" ? result : null;
		}, { attempts: 120, intervalMs: 250 });
		return report;
	}
	const impact = await analyze(revision);
	assert.equal(impact.readiness, "incompatible");
	assert.equal(impact.impact.counts.newly_invalid, 1);
	let retainedHtml;
	if (hasRepairReports) {
		const snapshot = impact.impact.findings.find((finding) => finding.object_id === object.data.id)?.snapshot;
		assert.equal(snapshot?.object_revision, object.data.revision);
		assert.ok(Number.isFinite(Date.parse(snapshot.inspected_at)));
		assert.ok(snapshot.diagnostics.issues.some((issue) => issue.reason.missing_property === "hostname"));
		const nested = snapshot.diagnostics.issues.find((issue) => issue.instance_path === "/interfaces/3/address");
		assert.equal(nested?.actual, "number");
		assert.deepEqual(nested.expected, { status: "available", value: "string" });
		assert.ok(nested.omissions.includes("actual_value_redacted"));
		assert.equal(snapshot.diagnostics.truncated, false);
		const layout = await request("POST", "/api/v1/export-templates", { ...auth, expected: 201, body: {
			collection_id: collectionId, name: `schema_repair_${suffix}`, description: "Schema repair contract layout", content_type: "text/html", kind: "fragment", template: "<h1>Repair contract layout</h1>{{ report_content }}",
		} });
		const generated = await request("POST", `${schema}/tasks/${impact.task_id}/report`, { ...auth, body: {
			object_url_template: `https://console.example/objects/${classId}/{object_id}`, template_id: layout.data.id,
		} });
		retainedHtml = generated.data;
		assert.ok(generated.headers.get("content-type").startsWith("text/html"));
		assert.ok(retainedHtml.includes("Repair contract layout"));
		assert.ok(retainedHtml.includes(`/interfaces/3/address`));
		const decodedHtml = retainedHtml.replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (_match, hex, decimal) => String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10)));
		assert.ok(decodedHtml.includes(`https://console.example/objects/${classId}/${object.data.id}`));
		assert.equal((await request("GET", `${schema}/tasks/${impact.task_id}/report`, auth)).data, retainedHtml);
		const download = await request("GET", `${schema}/tasks/${impact.task_id}/report`, { ...auth, query: { download: true } });
		assert.equal(download.data, retainedHtml);
		assert.match(download.headers.get("content-disposition"), /attachment/);
	} else {
		assert.equal(impact.impact.failures[0].reason.missing_property, "hostname");
	}
	await request("POST", `${schema}/revisions/${revision}/activate`, {
		...auth, body: { expected_active_revision: 1, policy: "reject_incompatible", impact_task_id: impact.task_id }, expected: 409,
	});
	const reader = { token: readerToken };
	if (hasRepairReports) {
		await request("POST", `${schema}/tasks/${impact.task_id}/report`, { ...reader, expected: 403, body: { object_url_template: `https://console.example/objects/${classId}/{object_id}` } });
		await request("GET", `${schema}/tasks/${impact.task_id}/report`, { ...reader, expected: 403 });
		await request("GET", `${schema}/tasks/${impact.task_id}/report`, { ...reader, expected: 403, query: { download: true } });
	}
	await request("GET", `${schema}/revisions`, reader);
	await request("GET", schema, { ...reader, expected: 403 });
	await request("GET", `${schema}/tasks/${impact.task_id}`, { ...reader, expected: 403 });
	await request("GET", `/api/v1/tasks/${impact.task_id}`, { ...reader, expected: [403, 404] });
	await request("POST", `${schema}/revisions/${revision}/activate`, { ...reader, body: { expected_active_revision: 1, policy: "allow_pending" }, expected: 403 });
	const readerTasks = await request("GET", "/api/v1/tasks", { ...reader, query: { kind: "schema_validation", include_total: false } });
	assert.equal(readerTasks.data.length, 0);
	const activation = await request("POST", `${schema}/revisions/${revision}/activate`, { ...auth, body: { expected_active_revision: 1, policy: "allow_pending" } });
	assert.equal(activation.data.active.revision, revision);
	assert.ok(activation.data.task_id);
	await waitFor("invalid object evidence", async () => {
		const result = (await request("GET", `${schema}/objects`, { ...reader, query: { status: "invalid", limit: 1 } })).data;
		return result.items.some((item) => item.object_id === object.data.id) ? result : null;
	}, { attempts: 120, intervalMs: 250 });
	const unchanged = await request("GET", `${path}/${object.data.id}`, auth);
	assert.deepEqual(unchanged.data.data, initialData);
	assert.equal(unchanged.data.revision, object.data.revision);
	await request("PATCH", `${path}/${object.data.id}`, { ...auth, body: { data: { hostname: "schema-test" } } });
	if (hasRepairReports) assert.equal((await request("GET", `${schema}/tasks/${impact.task_id}/report`, auth)).data, retainedHtml);

	const relaxed = await request("POST", `${schema}/revisions`, { ...auth, expected: 201, body: { json_schema: { type: "object" }, validate_schema: true } });
	const compatible = await analyze(relaxed.data.revision);
	assert.equal(compatible.readiness, "compatible");
	await request("PATCH", `${path}/${object.data.id}`, { ...auth, body: { description: "Change population epoch" } });
	const stale = await request("GET", `${schema}/tasks/${compatible.task_id}`, auth);
	assert.equal(stale.data.readiness, "inconclusive");
	await request("POST", `${schema}/revisions/${relaxed.data.revision}/activate`, { ...auth, expected: 409, body: { expected_active_revision: revision, policy: "reject_incompatible", impact_task_id: compatible.task_id } });
	const fresh = await analyze(relaxed.data.revision);
	await request("POST", `${schema}/revisions/${relaxed.data.revision}/activate`, { ...auth, body: { expected_active_revision: revision, policy: "reject_incompatible", impact_task_id: fresh.task_id } });
	const abandoned = await request("POST", `${schema}/revisions`, { ...auth, expected: 201, body: { json_schema: false, validate_schema: true } });
	assert.equal((await request("DELETE", `${schema}/revisions/${abandoned.data.revision}`, auth)).data.status, "abandoned");
	const current = await request("GET", schema, auth);
	assert.equal(current.data.active.revision, relaxed.data.revision);
}
