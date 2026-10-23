import assert from "node:assert/strict";

export async function verifyHistoryRestores({ request, auth, classId, objectId }) {
  const path = `/api/v1/classes/${classId}/${objectId}`;
  const initial = await request("GET", path, auth);
  const sourcePage = await request("GET", `${path}/history`, { ...auth, query: { include_total: false, limit: 25 } });
  assert.equal(sourcePage.headers.get("x-total-count"), null);
  const source = sourcePage.data[0];
  assert.ok(source?.history_id);
  const resolved = await request("GET", `${path}/history/as-of`, { ...auth, query: { at: source.valid_from } });
  assert.equal(resolved.data.history_id, source.history_id, "Exact server timestamps must resolve the same stored version");
  const headers = { "Content-Type": "application/json-patch+json" };
  const changed = await request("PATCH", `${path}/data`, { ...auth, headers, body: [
    { op: "test", path: "", value: initial.data.data },
    { op: "add", path: "/later_restore_field", value: { nested: null } },
  ] });
  await request("PATCH", `${path}/data`, { ...auth, headers, expected: [409], body: [
    { op: "test", path: "", value: initial.data.data },
    { op: "replace", path: "", value: source.data },
  ] });
  const unchanged = await request("GET", path, auth);
  assert.deepEqual(unchanged.data.data, changed.data.data, "Stale whole-document guard must preserve concurrent additions");
  const etag = unchanged.headers.get("etag");
  assert.ok(etag && !etag.startsWith("W/"), "Released server must provide a strong object validator");
  const restored = await request("PATCH", `${path}/data`, { ...auth, headers: { ...headers, "If-Match": etag }, body: [
    { op: "test", path: "", value: unchanged.data.data },
    { op: "replace", path: "", value: source.data },
  ] });
  assert.deepEqual(restored.data.data, source.data);
  assert.ok(restored.data.revision > unchanged.data.revision);
  await request("PATCH", `${path}/data`, { ...auth, headers: { ...headers, "If-Match": etag }, expected: [412], body: [
    { op: "test", path: "", value: restored.data.data },
    { op: "replace", path: "", value: changed.data.data },
  ] });
  const history = await request("GET", `${path}/history`, { ...auth, query: { include_total: false, limit: 25 } });
  assert.ok(history.data.some((row) => row.history_id === source.history_id), "Restoration must preserve the source record");
  assert.equal(history.data[0].revision, restored.data.revision);
  const events = await request("GET", `${path}/events`, { ...auth, query: { include_total: false, limit: 25 } });
  assert.ok(events.data.some((event) => event.after_revision === restored.data.revision), "Restoration must create a normal audit event");
  const noop = await request("PATCH", `${path}/data`, { ...auth, headers, body: [
    { op: "test", path: "", value: restored.data.data },
    { op: "replace", path: "", value: restored.data.data },
  ] });
  assert.equal(noop.data.revision, restored.data.revision);

  const classPath = `/api/v1/classes/${classId}`;
  const classBefore = await request("GET", classPath, auth);
  const classEtag = classBefore.headers.get("etag");
  assert.ok(classEtag && !classEtag.startsWith("W/"));
  const classChanged = await request("PATCH", classPath, { ...auth, headers: { "If-Match": classEtag }, body: { description: "Temporary history restore verification" } });
  await request("PATCH", classPath, { ...auth, headers: { "If-Match": classEtag }, body: { description: classBefore.data.description }, expected: [412] });
  const classReview = await request("GET", classPath, auth);
  assert.equal(classReview.data.description, classChanged.data.description);
  const classRestored = await request("PATCH", classPath, { ...auth, headers: { "If-Match": classReview.headers.get("etag") }, body: { description: classBefore.data.description } });
  assert.equal(classRestored.data.description, classBefore.data.description);
  assert.deepEqual(classRestored.data.json_schema, classBefore.data.json_schema);
  assert.equal(classRestored.data.validate_schema, classBefore.data.validate_schema);

  // Navigation must remain lightweight, exact, and scoped in the released contract.
  for (const resourcePath of [path, classPath]) {
    const markers = await request("GET", `${resourcePath}/history/timeline`, { ...auth, query: { limit: 1, include_total: false, direction: "older" } });
    assert.equal(markers.headers.get("x-total-count"), null);
    const marker = markers.data[0];
    assert.ok(marker?.history_id);
    assert.equal(Object.hasOwn(marker, "data"), false);
    assert.equal(Object.hasOwn(marker, "json_schema"), false);
    const entry = await request("GET", `${resourcePath}/history/entries/${marker.history_id}`, auth);
    assert.equal(entry.data.history_id, marker.history_id);
    assert.equal(entry.data.valid_from, marker.valid_from);
    const older = await request("GET", `${resourcePath}/history/timeline`, { ...auth, query: { anchor: marker.history_id, direction: "older", limit: 1, include_total: false } });
    assert.ok(older.data.every(row => row.history_id !== marker.history_id));
    const relations = await request("GET", `${resourcePath}/relations/history/as-of`, { ...auth, query: { at: marker.valid_from, limit: 1, include_total: false } });
    assert.equal(relations.data.coverage, "retained_history");
    assert.ok(Array.isArray(relations.data.relations));
  }
  const population = await request("GET", `${classPath}/objects/history/as-of`, { ...auth, query: { at: source.valid_from, limit: 25, include_total: false } });
  assert.equal(population.data.coverage, "retained_history");
  assert.ok(population.data.objects.some(row => row.id === objectId && row.history_id === source.history_id));
  const computed = await request("GET", `${path}/history/computed/as-of`, { ...auth, query: { at: source.valid_from } });
  assert.equal(computed.data.mode, "historical_recomputation");
  assert.equal(computed.data.object.history_id, source.history_id);
  assert.equal(computed.data.personal, "unsupported");
}
