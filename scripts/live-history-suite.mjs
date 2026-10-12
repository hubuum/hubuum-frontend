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
}
