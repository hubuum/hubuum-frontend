const baseUrl = process.env.HUBUUM_LIVE_BACKEND_URL ?? "http://127.0.0.1:9999";
const adminName = process.env.HUBUUM_LIVE_ADMIN_USER ?? "admin";
const adminPassword = process.env.HUBUUM_LIVE_ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error("HUBUUM_LIVE_ADMIN_PASSWORD is required.");
}

const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
const state = {
  passed: 0,
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function pass(message) {
  state.passed += 1;
  console.log(`ok ${state.passed} - ${message}`);
}

function pathWithQuery(path, query) {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

async function request(method, path, options = {}) {
  const {
    body,
    expected = [200],
    headers,
    query,
    token,
  } = options;
  const response = await fetch(`${baseUrl}${pathWithQuery(path, query)}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const data = text && contentType.includes("application/json") ? JSON.parse(text) : text;
  const allowed = Array.isArray(expected) ? expected : [expected];

  if (!allowed.includes(response.status)) {
    throw new Error(
      `${method} ${path} returned ${response.status}, expected ${allowed.join(", ")}.\n${text}`,
    );
  }

  return { data, headers: response.headers, status: response.status };
}

function expectArray(value, label) {
  assert(Array.isArray(value), `${label} should return an array.`);
}

function expectId(value, label) {
  assert(value && Number.isInteger(value.id), `${label} should include an integer id.`);
}

function includesPermission(permissionRows, groupId, flag) {
  const rows = Array.isArray(permissionRows) ? permissionRows : [permissionRows];
  return rows.some((row) => row?.group_id === groupId && row?.[flag] === true);
}

function hasHeader(headers, name) {
  return headers.get(name) !== null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(description, probe, { attempts = 30, intervalMs = 250 } = {}) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await probe();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function loginAs(name, password) {
  const login = await request("POST", "/api/v0/auth/login", {
    body: { name, password },
  });
  const token = login.data.token;
  assert(typeof token === "string" && token.length > 0, `Login for ${name} did not include a token.`);
  return token;
}

async function listDeliveries(token, query = { limit: 50, sort: "-updated_at" }) {
  const response = await request("GET", "/api/v1/event-deliveries", { token, query });
  expectArray(response.data, "Event deliveries");
  return response;
}

async function waitForDelivery(token, subscriptionId) {
  return waitFor(`delivery for subscription ${subscriptionId}`, async () => {
    const deliveries = await listDeliveries(token);
    return deliveries.data.find((delivery) => delivery.subscription_id === subscriptionId);
  });
}

async function main() {
  await request("GET", "/healthz");
  pass("health endpoint is reachable");

  await request("GET", "/readyz");
  pass("readiness endpoint is reachable");

  const clientConfig = await request("GET", "/api/v1/config");
  assert(
    Number.isInteger(clientConfig.data.pagination?.default_page_limit) &&
      clientConfig.data.pagination.default_page_limit > 0,
    "Client config is missing the effective default page limit.",
  );
  assert(
    Number.isInteger(clientConfig.data.pagination?.max_page_limit) &&
      clientConfig.data.pagination.max_page_limit >= clientConfig.data.pagination.default_page_limit,
    "Client config is missing the effective maximum page limit.",
  );
  pass("discovered public v0.0.3 pagination capabilities");

  const openapi = await request("GET", "/api-doc/openapi.json");
  assert(openapi.data.paths?.["/api/v1/events"], "OpenAPI is missing /api/v1/events.");
  assert(
    openapi.data.paths?.["/api/v1/collections/{collection_id}/event-subscriptions"],
    "OpenAPI is missing collection event subscriptions.",
  );
  assert(openapi.data.paths?.["/api/v1/backups"], "OpenAPI is missing backups.");
  assert(openapi.data.paths?.["/api/v1/restores"], "OpenAPI is missing restores.");
  assert(
    openapi.data.paths?.["/api/v1/classes/{class_id}/computed-fields"],
    "OpenAPI is missing shared computed fields.",
  );
  assert(
    openapi.data.paths?.["/api/v1/iam/me/computed-fields"],
    "OpenAPI is missing personal computed fields.",
  );
  const v003Paths = [
    "/api/v1/config",
    "/api/v1/classes/{class_id}/object-aggregates",
    "/api/v1/classes/{class_id}/{object_id}/data",
    "/api/v1/classes/by-name/{class_name}",
    "/api/v1/classes/by-name/{class_name}/object-aggregates",
    "/api/v1/classes/by-name/{class_name}/objects",
    "/api/v1/classes/by-name/{class_name}/objects/by-name/{object_name}",
    "/api/v1/classes/by-name/{class_name}/objects/by-name/{object_name}/data",
    "/api/v1/classes/by-name/{class_name}/permissions",
    "/api/v1/classes/by-name/{class_name}/related/classes",
    "/api/v1/classes/by-name/{class_name}/related/relations",
    "/api/v1/classes/by-name/{class_name}/related/graph",
    "/api/v1/classes/by-name/{class_name}/objects/by-name/{object_name}/related/objects",
    "/api/v1/classes/by-name/{class_name}/objects/by-name/{object_name}/related/relations",
    "/api/v1/classes/by-name/{class_name}/objects/by-name/{object_name}/related/graph",
  ];
  for (const path of v003Paths) {
    assert(openapi.data.paths?.[path], `OpenAPI is missing ${path}.`);
  }
  pass("server OpenAPI exposes the complete v0.0.3 endpoint surface");

  const token = await loginAs(adminName, adminPassword);
  pass("admin login returns a bearer token");

  const auth = { token };
  const adminUserId = 1;

  const runningConfig = await request("GET", "/api/v1/admin/config", auth);
  assert(runningConfig.data.backups, "Admin config is missing backup settings.");
  assert(runningConfig.data.restores, "Admin config is missing restore settings.");
  assert(runningConfig.data.permissions, "Admin config is missing permission settings.");
  pass("read redacted v0.0.3 admin runtime configuration");

  const group = await request("POST", "/api/v1/iam/groups", {
    ...auth,
    body: {
      description: "Created by frontend live backend contract tests",
      groupname: `live_group_${suffix}`,
    },
    expected: 201,
  });
  expectId(group.data, "Created group");
  pass("created IAM group");

  const collection = await request("POST", "/api/v1/collections", {
    ...auth,
    body: {
      description: "Created by frontend live backend contract tests",
      group_id: group.data.id,
      name: `live_collection_${suffix}`,
    },
    expected: 201,
  });
  expectId(collection.data, "Created collection");
  pass("created collection with group permissions");

  const hubuumClass = await request("POST", "/api/v1/classes", {
    ...auth,
    body: {
      description: "Created by frontend live backend contract tests",
      json_schema: {},
      name: `live_class_${suffix}`,
      collection_id: collection.data.id,
      validate_schema: false,
    },
    expected: 201,
  });
  expectId(hubuumClass.data, "Created class");
  pass("created class");

  const hubuumObject = await request("POST", `/api/v1/classes/${hubuumClass.data.id}/`, {
    ...auth,
    body: {
      data: { live_backend_test: true, suffix },
      description: "Created by frontend live backend contract tests",
      hubuum_class_id: hubuumClass.data.id,
      name: `live_object_${suffix}`,
      collection_id: collection.data.id,
    },
    expected: 201,
  });
  expectId(hubuumObject.data, "Created object");
  pass("created object");

  const sharedComputed = await request(
    "POST",
    `/api/v1/classes/${hubuumClass.data.id}/computed-fields`,
    {
      ...auth,
      body: {
        description: "Shared live-backend contract field",
        enabled: true,
        key: "live_flag",
        label: "Live flag",
        operation: { type: "first_non_null", paths: ["/live_backend_test"] },
        result_type: "boolean",
      },
      expected: 201,
    },
  );
  expectId(sharedComputed.data.definition, "Created shared computed field");
  assert(sharedComputed.data.state?.class_id === hubuumClass.data.id, "Shared field response is missing class state.");
  pass("created shared computed field");

  const personalComputed = await request("POST", "/api/v1/iam/me/computed-fields", {
    ...auth,
    body: {
      class_id: hubuumClass.data.id,
      description: "Personal live-backend contract field",
      enabled: true,
      key: "live_suffix",
      label: "Live suffix",
      operation: { type: "first_non_null", paths: ["/suffix"] },
      result_type: "string",
    },
    expected: 201,
  });
  expectId(personalComputed.data, "Created personal computed field");
  pass("created personal computed field");

  const computedPreview = await request(
    "POST",
    `/api/v1/classes/${hubuumClass.data.id}/computed-fields/preview`,
    {
      ...auth,
      body: {
        data: { live_backend_test: true },
        definition: {
          description: "Preview",
          enabled: true,
          key: "preview_flag",
          label: "Preview flag",
          operation: { type: "first_non_null", paths: ["/live_backend_test"] },
          result_type: "boolean",
        },
      },
    },
  );
  assert(computedPreview.data.value === true, "Computed preview should return true.");
  pass("previewed a computed field against sample data");

  const computedObject = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}`,
    { ...auth, query: { include: "computed" } },
  );
  assert(computedObject.data.computed?.shared?.values?.live_flag === true, "Shared computed value is missing.");
  assert(computedObject.data.computed?.personal?.values?.live_suffix === suffix, "Personal computed value is missing.");
  pass("read shared and personal computed values on an object");

  const sharedDefinitions = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/computed-fields`,
    auth,
  );
  expectArray(sharedDefinitions.data.definitions, "Shared computed definitions");
  const personalDefinitions = await request("GET", "/api/v1/iam/me/computed-fields", {
    ...auth,
    query: { class_id: hubuumClass.data.id },
  });
  expectArray(personalDefinitions.data, "Personal computed definitions");
  pass("listed shared and personal computed definitions");

  const classNamePath = encodeURIComponent(hubuumClass.data.name);
  const nameAddressedClass = await request(
    "GET",
    `/api/v1/classes/by-name/${classNamePath}`,
    auth,
  );
  assert(nameAddressedClass.data.id === hubuumClass.data.id, "By-name class read resolved the wrong class.");
  await request("PATCH", `/api/v1/classes/by-name/${classNamePath}`, {
    ...auth,
    body: { description: "Updated through the v0.0.3 by-name route" },
  });
  pass("read and updated a class through numeric-safe name addressing");

  const secondObjectName = `live_object_second_${suffix}`;
  const secondObject = await request(
    "POST",
    `/api/v1/classes/by-name/${classNamePath}/objects`,
    {
      ...auth,
      body: {
        data: { live_backend_test: true, suffix: `${suffix}_second` },
        description: "Created without class or collection IDs",
        name: secondObjectName,
      },
      expected: 201,
    },
  );
  expectId(secondObject.data, "Name-addressed object creation");
  const secondObjectNamePath = encodeURIComponent(secondObjectName);
  const nameAddressedObject = await request(
    "GET",
    `/api/v1/classes/by-name/${classNamePath}/objects/by-name/${secondObjectNamePath}`,
    auth,
  );
  assert(nameAddressedObject.data.id === secondObject.data.id, "By-name object read resolved the wrong object.");
  await request(
    "PATCH",
    `/api/v1/classes/by-name/${classNamePath}/objects/by-name/${secondObjectNamePath}`,
    { ...auth, body: { description: "Updated through the v0.0.3 by-name route" } },
  );
  const nameAddressedObjects = await request(
    "GET",
    `/api/v1/classes/by-name/${classNamePath}/objects`,
    { ...auth, query: { limit: 25 } },
  );
  expectArray(nameAddressedObjects.data, "Name-addressed class objects");
  assert(
    nameAddressedObjects.data.some((item) => item.id === secondObject.data.id),
    "Name-addressed object list omitted the created object.",
  );
  pass("created, listed, read, and updated objects through name-addressed routes");

  const jsonPatchHeaders = { "Content-Type": "application/json-patch+json" };
  const idPatchedObject = await request(
    "PATCH",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}/data`,
    {
      ...auth,
      body: [
        { op: "test", path: "/live_backend_test", value: true },
        { op: "add", path: "/patched_by_id", value: true },
      ],
      headers: jsonPatchHeaders,
    },
  );
  assert(idPatchedObject.data.data?.patched_by_id === true, "ID-addressed JSON Patch did not persist.");
  const namePatchedObject = await request(
    "PATCH",
    `/api/v1/classes/by-name/${classNamePath}/objects/by-name/${secondObjectNamePath}/data`,
    {
      ...auth,
      body: [
        { op: "test", path: "/live_backend_test", value: true },
        { op: "add", path: "/patched_by_name", value: true },
      ],
      headers: jsonPatchHeaders,
    },
  );
  assert(
    namePatchedObject.data.data?.patched_by_name === true,
    "Name-addressed JSON Patch did not persist.",
  );
  pass("applied guarded RFC 6902 object-data patches by ID and name");

  const computedQuery = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/`,
    {
      ...auth,
      query: {
        "computed.shared.live_flag__equals": true,
        include: "computed",
        limit: 25,
        sort: "computed.personal.live_suffix.desc",
      },
    },
  );
  expectArray(computedQuery.data, "Computed object query");
  assert(computedQuery.data.length === 2, "Computed filtering should match both live objects.");
  assert(
    computedQuery.data[0]?.id === secondObject.data.id,
    "Computed descending sort returned an unexpected first object.",
  );
  assert(hasHeader(computedQuery.headers, "x-page-limit"), "Computed query omitted X-Page-Limit.");
  pass("filtered and cursor-sorted class objects by computed fields");

  const idAggregates = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/object-aggregates`,
    {
      ...auth,
      query: {
        "computed.shared.live_flag__equals": true,
        group_by: "computed.shared.live_flag",
        limit: 1,
        sort: "object_count.desc",
      },
    },
  );
  expectArray(idAggregates.data, "ID-addressed object aggregates");
  assert(idAggregates.data[0]?.object_count === 2, "Computed aggregate count should include both objects.");
  assert(hasHeader(idAggregates.headers, "x-total-count"), "Aggregates omitted X-Total-Count.");
  assert(hasHeader(idAggregates.headers, "x-page-limit"), "Aggregates omitted X-Page-Limit.");
  const nameAggregates = await request(
    "GET",
    `/api/v1/classes/by-name/${classNamePath}/object-aggregates`,
    { ...auth, query: { group_by: "name", limit: 25, sort: "dimensions.asc" } },
  );
  expectArray(nameAggregates.data, "Name-addressed object aggregates");
  assert(nameAggregates.data.length === 2, "Name-addressed aggregation should return two name groups.");
  pass("queried permission-aware object aggregates by ID and name");

  const classByNameReadPaths = ["permissions", "related/classes", "related/relations", "related/graph"];
  for (const suffixPath of classByNameReadPaths) {
    await request("GET", `/api/v1/classes/by-name/${classNamePath}/${suffixPath}`, auth);
  }
  const objectByNameReadPaths = ["related/objects", "related/relations", "related/graph"];
  for (const suffixPath of objectByNameReadPaths) {
    await request(
      "GET",
      `/api/v1/classes/by-name/${classNamePath}/objects/by-name/${secondObjectNamePath}/${suffixPath}`,
      auth,
    );
  }
  pass("read all class- and object-rooted by-name views");

  const disposableObjectName = `live_disposable_object_${suffix}`;
  await request("POST", `/api/v1/classes/by-name/${classNamePath}/objects`, {
    ...auth,
    body: {
      data: {},
      description: "Disposable object for by-name delete coverage",
      name: disposableObjectName,
    },
    expected: 201,
  });
  await request(
    "DELETE",
    `/api/v1/classes/by-name/${classNamePath}/objects/by-name/${encodeURIComponent(disposableObjectName)}`,
    { ...auth, expected: 204 },
  );
  const disposableClassName = `live_disposable_class_${suffix}`;
  await request("POST", "/api/v1/classes", {
    ...auth,
    body: {
      collection_id: collection.data.id,
      description: "Disposable class for by-name delete coverage",
      json_schema: {},
      name: disposableClassName,
      validate_schema: false,
    },
    expected: 201,
  });
  await request("DELETE", `/api/v1/classes/by-name/${encodeURIComponent(disposableClassName)}`, {
    ...auth,
    expected: 204,
  });
  pass("deleted disposable objects and classes through by-name routes");

  const rebuild = await request(
    "POST",
    `/api/v1/classes/${hubuumClass.data.id}/computed-fields/rebuild`,
    { ...auth, expected: 202 },
  );
  assert(rebuild.data.class_id === hubuumClass.data.id, "Computed rebuild response has the wrong class.");
  pass("queued a shared computed-field rebuild");

  const backup = await request("POST", "/api/v1/backups", {
    ...auth,
    body: { include_history: false },
    expected: 202,
  });
  expectId(backup.data, "Created backup task");
  const completedBackup = await waitFor(
    `backup task ${backup.data.id}`,
    async () => {
      const task = await request("GET", `/api/v1/backups/${backup.data.id}`, auth);
      if (task.data.status === "failed" || task.data.status === "cancelled") {
        throw new Error(`Backup task ended with ${task.data.status}.`);
      }
      return task.data.status === "succeeded" ? task.data : null;
    },
    { attempts: 60, intervalMs: 250 },
  );
  assert(completedBackup.details?.backup?.output_available, "Backup output should be available.");
  pass("created and completed a backup task");

  const backupOutput = await request("GET", `/api/v1/backups/${backup.data.id}/output`, auth);
  assert(backupOutput.data.backup_version === 3, "Backup document should use format version 3.");
  assert(hasHeader(backupOutput.headers, "digest"), "Backup output should include Digest.");
  assert(
    hasHeader(backupOutput.headers, "x-hubuum-backup-sha256"),
    "Backup output should include X-Hubuum-Backup-SHA256.",
  );
  pass("downloaded backup output with integrity metadata");

  const stagedRestore = await request("POST", "/api/v1/restores", {
    ...auth,
    body: backupOutput.data,
    expected: 201,
  });
  expectId(stagedRestore.data, "Staged restore");
  assert(
    typeof stagedRestore.data.restore_capability === "string" &&
      stagedRestore.data.restore_capability.length > 0,
    "Staged restore should return a one-time capability.",
  );
  assert(stagedRestore.data.validation?.backup_version === 3, "Restore validation should report backup version 3.");
  const restoreStatus = await request(
    "GET",
    `/api/v1/restores/${stagedRestore.data.id}/status`,
    {
      ...auth,
      headers: { "X-Hubuum-Restore-Capability": stagedRestore.data.restore_capability },
    },
  );
  assert(restoreStatus.data.status === "validated", "Staged restore should remain validated.");
  pass("staged and inspected a restore without replacing live data");

  const limitedGroup = await request("POST", "/api/v1/iam/groups", {
    ...auth,
    body: {
      description: "Limited group for frontend live backend contract tests",
      groupname: `live_limited_group_${suffix}`,
    },
    expected: 201,
  });
  expectId(limitedGroup.data, "Created limited group");
  pass("created limited IAM group");

  const limitedPassword = `LiveBackendTest_${suffix}!`;
  const limitedUser = await request("POST", "/api/v1/iam/users", {
    ...auth,
    body: {
      email: `live_${suffix}@example.test`,
      name: `live_user_${suffix}`,
      password: limitedPassword,
      proper_name: "Live Backend Test User",
    },
    expected: 201,
  });
  expectId(limitedUser.data, "Created limited user");
  pass("created limited user");

  await request(
    "POST",
    `/api/v1/iam/groups/${limitedGroup.data.id}/members/${limitedUser.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("added limited user to limited group");

  let limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  const limitedEventsBeforeReadAudit = await request("GET", `/api/v1/collections/${collection.data.id}/events`, {
    token: limitedToken,
  });
  expectArray(limitedEventsBeforeReadAudit.data, "Limited events before ReadAudit");
  assert(
    limitedEventsBeforeReadAudit.data.length === 0,
    "Limited user without ReadAudit should not see collection events.",
  );
  pass("limited user without ReadAudit receives no collection events");

  await request(
    "PUT",
    `/api/v1/collections/${collection.data.id}/permissions/group/${limitedGroup.data.id}`,
    {
      ...auth,
      body: ["ReadAudit"],
      expected: [200, 204],
    },
  );
  pass("granted limited group ReadAudit only");

  const limitedGroupPermissions = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/permissions/group/${limitedGroup.data.id}`,
    auth,
  );
  assert(
    includesPermission(limitedGroupPermissions.data, limitedGroup.data.id, "has_read_audit"),
    "Limited group permissions should persist ReadAudit.",
  );
  pass("verified limited group ReadAudit permission");

  limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  const limitedPermissions = await request("GET", "/api/v1/iam/me/permissions", {
    token: limitedToken,
  });
  expectArray(limitedPermissions.data, "Current user permissions");
  assert(
    JSON.stringify(limitedPermissions.data).includes("ReadAudit"),
    "Limited user effective permissions should include ReadAudit.",
  );
  assert(
    !JSON.stringify(limitedPermissions.data).includes("ManageEventSubscription"),
    "Limited user should not have ManageEventSubscription yet.",
  );
  pass("limited user effective permissions include ReadAudit but not ManageEventSubscription");

  const limitedEventsAfterReadAudit = await request("GET", `/api/v1/collections/${collection.data.id}/events`, {
    token: limitedToken,
  });
  expectArray(limitedEventsAfterReadAudit.data, "Limited events after ReadAudit");
  assert(
    limitedEventsAfterReadAudit.data.length > 0,
    "Limited user with ReadAudit should see collection events.",
  );
  pass("limited user with ReadAudit can read collection events");

  const principalPermissions = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/permissions/principal/${limitedUser.data.id}`,
    { ...auth, query: { limit: 25 } },
  );
  expectArray(principalPermissions.data, "Principal collection permissions");
  pass("listed limited user's effective collection permissions");

  const readAuditGroups = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/has_permissions/ReadAudit`,
    { ...auth, query: { limit: 25 } },
  );
  expectArray(readAuditGroups.data, "Groups with ReadAudit");
  pass("listed groups with ReadAudit permission");

  const globalEvents = await request("GET", "/api/v1/events", {
    ...auth,
    query: {
      entity_id: collection.data.id,
      entity_type: "collection",
      limit: 25,
      sort: "-occurred_at",
    },
  });
  expectArray(globalEvents.data, "Global events");
  assert(hasHeader(globalEvents.headers, "x-total-count"), "Global events should include X-Total-Count.");
  pass("read global audit/event feed with filters");

  const eventPageOne = await request("GET", "/api/v1/events", {
    ...auth,
    query: { limit: 1, sort: "-occurred_at" },
  });
  expectArray(eventPageOne.data, "First event page");
  assert(hasHeader(eventPageOne.headers, "x-total-count"), "Event page should include X-Total-Count.");
  const eventCursor = eventPageOne.headers.get("x-next-cursor");
  if (eventCursor) {
    const eventPageTwo = await request("GET", "/api/v1/events", {
      ...auth,
      query: { cursor: eventCursor, limit: 1, sort: "-occurred_at" },
    });
    expectArray(eventPageTwo.data, "Second event page");
  }
  pass("validated event cursor pagination headers");

  const filteredEvents = await request("GET", "/api/v1/events", {
    ...auth,
    query: {
      action: "created",
      actor_kind: "user",
      actor_user_id: adminUserId,
      entity_type: "collection",
      limit: 10,
      collection_id: collection.data.id,
      sort: "-occurred_at",
    },
  });
  expectArray(filteredEvents.data, "Filtered events");
  assert(filteredEvents.data.length > 0, "Filtered events should include collection creation.");
  pass("read event feed with action, actor, entity type, and collection filters");

  const collectionEvents = await request("GET", `/api/v1/collections/${collection.data.id}/events`, {
    ...auth,
    query: { limit: 25, sort: "-occurred_at" },
  });
  expectArray(collectionEvents.data, "Collection events");
  pass("read collection event feed");

  const groupEvents = await request("GET", `/api/v1/iam/groups/${group.data.id}/events`, {
    ...auth,
    query: { limit: 25, sort: "-occurred_at" },
  });
  expectArray(groupEvents.data, "Group events");
  pass("read group event feed");

  const classEvents = await request("GET", `/api/v1/classes/${hubuumClass.data.id}/events`, {
    ...auth,
    query: { limit: 25, sort: "-occurred_at" },
  });
  expectArray(classEvents.data, "Class events");
  pass("read class event feed");

  const objectEvents = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}/events`,
    {
      ...auth,
      query: { limit: 25, sort: "-occurred_at" },
    },
  );
  expectArray(objectEvents.data, "Object events");
  pass("read object event feed");

  const collectionHistory = await request("GET", `/api/v1/collections/${collection.data.id}/history`, {
    ...auth,
    query: { limit: 25 },
  });
  expectArray(collectionHistory.data, "Collection history");
  assert(hasHeader(collectionHistory.headers, "x-total-count"), "Collection history should include X-Total-Count.");
  pass("read collection history");

  const classHistory = await request("GET", `/api/v1/classes/${hubuumClass.data.id}/history`, {
    ...auth,
    query: { limit: 25 },
  });
  expectArray(classHistory.data, "Class history");
  pass("read class history");

  const objectHistory = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}/history`,
    {
      ...auth,
      query: { limit: 25 },
    },
  );
  expectArray(objectHistory.data, "Object history");
  pass("read object history");

  const asOfBeforeUpdates = new Date().toISOString();
  await delay(25);

  const sink = await request("POST", "/api/v1/event-sinks", {
    ...auth,
    body: {
      config: {},
      enabled: true,
      kind: "webhook",
      name: `live_sink_${suffix}`,
    },
    expected: 201,
  });
  expectId(sink.data, "Created event sink");
  pass("created event sink");

  const loadedSink = await request("GET", `/api/v1/event-sinks/${sink.data.id}`, auth);
  expectId(loadedSink.data, "Loaded event sink");
  pass("loaded event sink");

  const patchedSink = await request("PATCH", `/api/v1/event-sinks/${sink.data.id}`, {
    ...auth,
    body: {
      enabled: false,
      name: `live_sink_disabled_${suffix}`,
      secret_ref: "live-test-secret-ref",
    },
  });
  assert(patchedSink.data.enabled === false, "Patched sink should be disabled.");
  assert(patchedSink.data.name === `live_sink_disabled_${suffix}`, "Patched sink should preserve name.");
  pass("patched event sink");

  await request("PATCH", `/api/v1/event-sinks/${sink.data.id}`, {
    ...auth,
    body: { enabled: true, name: `live_sink_${suffix}`, secret_ref: null },
  });
  pass("re-enabled event sink");

  await request("POST", "/api/v1/event-sinks", {
    ...auth,
    body: {
      config: {},
      enabled: true,
      kind: "not-a-real-sink-kind",
      name: `invalid_sink_${suffix}`,
    },
    expected: 400,
  });
  pass("rejected invalid event sink kind");

  const sinks = await request("GET", "/api/v1/event-sinks", auth);
  expectArray(sinks.data, "Event sinks");
  pass("listed event sinks");

  const deliverySubscription = await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        actions: ["updated"],
        description: "Delivery lifecycle subscription",
        enabled: true,
        entity_types: ["collection"],
        filter: {
          actor_kinds: ["user"],
          actor_user_ids: [adminUserId],
          entity_ids: [collection.data.id],
          collection_ids: [collection.data.id],
        },
        name: `live_delivery_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
      expected: 201,
    },
  );
  expectId(deliverySubscription.data, "Created delivery subscription");
  pass("created active delivery subscription");

  const disabledSink = await request("POST", "/api/v1/event-sinks", {
    ...auth,
    body: {
      config: {},
      enabled: false,
      kind: "webhook",
      name: `live_disabled_sink_${suffix}`,
    },
    expected: 201,
  });
  expectId(disabledSink.data, "Created disabled event sink");
  pass("created disabled event sink");

  const disabledSubscription = await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        actions: ["updated"],
        description: "Disabled sink subscription",
        enabled: true,
        entity_types: ["collection"],
        filter: {
          entity_ids: [collection.data.id],
          collection_ids: [collection.data.id],
        },
        name: `live_disabled_sink_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: disabledSink.data.id,
      },
      expected: 201,
    },
  );
  expectId(disabledSubscription.data, "Created disabled-sink subscription");
  pass("created subscription for disabled sink");

  await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      expected: 403,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["collection"],
        name: `limited_denied_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
    },
  );
  pass("limited user without ManageEventSubscription cannot create subscription");

  await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/permissions/group/${limitedGroup.data.id}/ManageEventSubscription`,
    { ...auth, expected: [200, 201, 204] },
  );
  pass("granted limited group ManageEventSubscription");

  limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  const limitedSubscription = await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      expected: 201,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["collection"],
        filter: {
          actor_kinds: ["user"],
          collection_ids: [collection.data.id],
        },
        name: `limited_allowed_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
    },
  );
  expectId(limitedSubscription.data, "Limited user subscription");
  pass("limited user with ManageEventSubscription can create subscription");

  await request(
    "DELETE",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${limitedSubscription.data.id}`,
    { expected: 204, token: limitedToken },
  );
  pass("limited user with ManageEventSubscription can delete subscription");

  const collectionUpdatedName = `live_collection_updated_${suffix}`;
  const classUpdatedName = `live_class_updated_${suffix}`;
  const objectUpdatedName = `live_object_updated_${suffix}`;

  const patchedCollection = await request("PATCH", `/api/v1/collections/${collection.data.id}`, {
    ...auth,
    body: {
      description: "Updated by frontend live backend contract tests",
      name: collectionUpdatedName,
    },
    expected: [200, 202],
  });
  assert(patchedCollection.data.name === collectionUpdatedName, "Collection patch should update name.");
  pass("patched collection for history and delivery checks");

  const firstDelivery = await waitForDelivery(token, deliverySubscription.data.id);
  expectId(firstDelivery, "Generated event delivery");
  pass("created event delivery from collection update");

  const disabledDeliveries = (await listDeliveries(token)).data.filter(
    (delivery) => delivery.subscription_id === disabledSubscription.data.id,
  );
  assert(disabledDeliveries.length === 0, "Disabled sink subscription should not create deliveries.");
  pass("disabled sink subscription does not fan out deliveries");

  await request("PATCH", `/api/v1/collections/${collection.data.id}`, {
    ...auth,
    body: {
      description: "Updated again by frontend live backend contract tests",
      name: `${collectionUpdatedName}_again`,
    },
    expected: [200, 202],
  });
  await waitFor("at least two deliveries for pagination", async () => {
    const deliveries = await listDeliveries(token);
    return deliveries.data.filter((delivery) => delivery.subscription_id === deliverySubscription.data.id)
      .length >= 2;
  });
  pass("created second event delivery for pagination");

  const deliveryPageOne = await listDeliveries(token, { limit: 1, sort: "-updated_at" });
  assert(hasHeader(deliveryPageOne.headers, "x-total-count"), "Deliveries should include X-Total-Count.");
  const deliveryCursor = deliveryPageOne.headers.get("x-next-cursor");
  if (deliveryCursor) {
    const deliveryPageTwo = await listDeliveries(token, {
      cursor: deliveryCursor,
      limit: 1,
      sort: "-updated_at",
    });
    expectArray(deliveryPageTwo.data, "Second delivery page");
  }
  pass("validated event delivery cursor pagination headers");

  const loadedDelivery = await request("GET", `/api/v1/event-deliveries/${firstDelivery.id}`, auth);
  expectId(loadedDelivery.data, "Loaded event delivery");
  pass("loaded event delivery by id");

  const deadDelivery = await request("POST", `/api/v1/event-deliveries/${firstDelivery.id}/dead`, auth);
  assert(deadDelivery.data.delivery?.status === "dead", "Delivery should be marked dead.");
  pass("marked event delivery dead");

  const retriedDelivery = await request("POST", `/api/v1/event-deliveries/${firstDelivery.id}/retry`, auth);
  assert(retriedDelivery.data.delivery?.status !== "dead", "Retried delivery should leave dead state.");
  pass("released event delivery for retry");

  const patchedClass = await request("PATCH", `/api/v1/classes/${hubuumClass.data.id}`, {
    ...auth,
    body: {
      description: "Updated by frontend live backend contract tests",
      json_schema: { type: "object" },
      name: classUpdatedName,
      validate_schema: false,
    },
    expected: [200, 202],
  });
  assert(patchedClass.data.name === classUpdatedName, "Class patch should update name.");
  pass("patched class for history checks");

  const patchedObject = await request(
    "PATCH",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}`,
    {
      ...auth,
      body: {
        data: { live_backend_test: true, patched: true, suffix },
        description: "Updated by frontend live backend contract tests",
        name: objectUpdatedName,
      },
      expected: [200, 202],
    },
  );
  assert(patchedObject.data.name === objectUpdatedName, "Object patch should update name.");
  pass("patched object for history checks");

  const collectionHistoryAfterPatch = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/history`,
    { ...auth, query: { limit: 1 } },
  );
  expectArray(collectionHistoryAfterPatch.data, "Collection history after patch");
  assert(
    Number(collectionHistoryAfterPatch.headers.get("x-total-count") ?? "0") >= 2,
    "Collection history should contain multiple versions after patch.",
  );
  pass("verified collection history records multiple versions");

  const historyCursor = collectionHistoryAfterPatch.headers.get("x-next-cursor");
  if (historyCursor) {
    const collectionHistoryPageTwo = await request(
      "GET",
      `/api/v1/collections/${collection.data.id}/history`,
      { ...auth, query: { cursor: historyCursor, limit: 1 } },
    );
    expectArray(collectionHistoryPageTwo.data, "Second collection history page");
  }
  pass("validated collection history cursor pagination headers");

  const collectionAsOf = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/history/as-of`,
    { ...auth, query: { at: asOfBeforeUpdates } },
  );
  expectId(collectionAsOf.data, "Collection as-of history");
  assert(collectionAsOf.data.name === collection.data.name, "Collection as-of should return original name.");
  pass("read collection as-of history");

  const classAsOf = await request("GET", `/api/v1/classes/${hubuumClass.data.id}/history/as-of`, {
    ...auth,
    query: { at: asOfBeforeUpdates },
  });
  expectId(classAsOf.data, "Class as-of history");
  assert(classAsOf.data.name === hubuumClass.data.name, "Class as-of should return original name.");
  pass("read class as-of history");

  const objectAsOf = await request(
    "GET",
    `/api/v1/classes/${hubuumClass.data.id}/${hubuumObject.data.id}/history/as-of`,
    { ...auth, query: { at: asOfBeforeUpdates } },
  );
  expectId(objectAsOf.data, "Object as-of history");
  assert(objectAsOf.data.name === hubuumObject.data.name, "Object as-of should return original name.");
  pass("read object as-of history");

  const subscriptionPayload = {
    actions: ["created"],
    description: "Created by frontend live backend contract tests",
    enabled: true,
    entity_types: ["collection"],
    filter: {
      actor_kinds: ["user"],
      actor_user_ids: [adminUserId],
      correlation_ids: ["00000000-0000-4000-8000-000000000001"],
      entity_ids: [collection.data.id],
      entity_names: [collection.data.name],
      collection_ids: [collection.data.id],
      related_collection_ids: [collection.data.id],
      request_ids: ["00000000-0000-4000-8000-000000000002"],
    },
    name: `live_subscription_${suffix}`,
    routing: { url: "https://example.test/events" },
    sink_id: sink.data.id,
  };
  const subscription = await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      ...auth,
      body: subscriptionPayload,
      expected: 201,
    },
  );
  expectId(subscription.data, "Created event subscription");
  assert(
    subscription.data.filter?.collection_ids?.includes(collection.data.id),
    "Created subscription did not preserve collection filter.",
  );
  assert(
    subscription.data.filter?.actor_user_ids?.includes(adminUserId),
    "Created subscription did not preserve actor user filter.",
  );
  assert(
    subscription.data.filter?.entity_names?.includes(collection.data.name),
    "Created subscription did not preserve entity name filter.",
  );
  pass("created collection event subscription with full filter matrix and routing");

  const subscriptions = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    auth,
  );
  expectArray(subscriptions.data, "Event subscriptions");
  assert(
    subscriptions.data.some((item) => item.id === subscription.data.id),
    "Subscription list did not include created subscription.",
  );
  pass("listed collection event subscriptions");

  const loadedSubscription = await request(
    "GET",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${subscription.data.id}`,
    auth,
  );
  expectId(loadedSubscription.data, "Loaded event subscription");
  pass("loaded collection event subscription");

  const patchedSubscription = await request(
    "PATCH",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${subscription.data.id}`,
    {
      ...auth,
      body: {
        enabled: false,
        filter: {
          actor_kinds: ["user"],
          entity_ids: [collection.data.id],
          collection_ids: [collection.data.id],
        },
      },
    },
  );
  assert(patchedSubscription.data.enabled === false, "Patched subscription should be disabled.");
  assert(
    patchedSubscription.data.filter?.entity_ids?.includes(collection.data.id),
    "Patched subscription did not preserve entity id filter.",
  );
  pass("patched collection event subscription filter");

  await request(
    "DELETE",
    `/api/v1/collections/${collection.data.id}/permissions/group/${limitedGroup.data.id}/ManageEventSubscription`,
    { ...auth, expected: [200, 204] },
  );
  limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      expected: 403,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["collection"],
        name: `limited_denied_again_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
    },
  );
  pass("revoking ManageEventSubscription blocks limited subscription creation again");

  const invalidSubscription = await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        ...subscriptionPayload,
        actions: ["updated"],
        entity_types: ["object_relation"],
        name: `invalid_subscription_${suffix}`,
      },
      expected: 400,
    },
  );
  assert(invalidSubscription.status === 400, "Invalid subscription should return 400.");
  pass("rejected invalid event subscription catalog combination");

  await request(
    "POST",
    `/api/v1/collections/${collection.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        ...subscriptionPayload,
        filter: { actor_kinds: ["anonymous"] },
        name: `invalid_filter_subscription_${suffix}`,
      },
      expected: 400,
    },
  );
  pass("rejected invalid event subscription filter values");

  const deliveryHealth = await request("GET", "/api/v1/event-deliveries/health", auth);
  assert(deliveryHealth.data.fanout, "Delivery health is missing fanout details.");
  assert(deliveryHealth.data.delivery, "Delivery health is missing delivery details.");
  pass("read event delivery health");

  const deliveries = await request("GET", "/api/v1/event-deliveries", {
    ...auth,
    query: { limit: 50, sort: "-updated_at" },
  });
  expectArray(deliveries.data, "Event deliveries");
  pass("listed event deliveries");

  await request(
    "DELETE",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${subscription.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("deleted collection event subscription");

  await request(
    "DELETE",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${deliverySubscription.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("deleted delivery lifecycle subscription");

  await request(
    "DELETE",
    `/api/v1/collections/${collection.data.id}/event-subscriptions/${disabledSubscription.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("deleted disabled-sink subscription");

  await request("DELETE", `/api/v1/event-sinks/${disabledSink.data.id}`, { ...auth, expected: 204 });
  pass("deleted disabled event sink");

  await request("DELETE", `/api/v1/event-sinks/${sink.data.id}`, { ...auth, expected: 204 });
  pass("deleted event sink");

  console.log(`Live backend contract suite passed against ${baseUrl}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
