const baseUrl = process.env.HUBUUM_LIVE_BACKEND_URL ?? "http://127.0.0.1:9999";
const adminName = process.env.HUBUUM_LIVE_ADMIN_USER ?? "admin";
const adminPassword = process.env.HUBUUM_LIVE_ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error("HUBUUM_LIVE_ADMIN_PASSWORD is required.");
}

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    query,
    token,
  } = options;
  const response = await fetch(`${baseUrl}${pathWithQuery(path, query)}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  const openapi = await request("GET", "/api-doc/openapi.json");
  assert(openapi.data.paths?.["/api/v1/events"], "OpenAPI is missing /api/v1/events.");
  assert(
    openapi.data.paths?.["/api/v1/namespaces/{namespace_id}/event-subscriptions"],
    "OpenAPI is missing namespace event subscriptions.",
  );
  pass("server OpenAPI exposes events and subscriptions");

  const token = await loginAs(adminName, adminPassword);
  pass("admin login returns a bearer token");

  const auth = { token };
  const adminUserId = 1;

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

  const namespace = await request("POST", "/api/v1/namespaces", {
    ...auth,
    body: {
      description: "Created by frontend live backend contract tests",
      group_id: group.data.id,
      name: `live_namespace_${suffix}`,
    },
    expected: 201,
  });
  expectId(namespace.data, "Created namespace");
  pass("created namespace with group permissions");

  const hubuumClass = await request("POST", "/api/v1/classes", {
    ...auth,
    body: {
      description: "Created by frontend live backend contract tests",
      json_schema: {},
      name: `live_class_${suffix}`,
      namespace_id: namespace.data.id,
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
      namespace_id: namespace.data.id,
    },
    expected: 201,
  });
  expectId(hubuumObject.data, "Created object");
  pass("created object");

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
  const limitedEventsBeforeReadAudit = await request("GET", `/api/v1/namespaces/${namespace.data.id}/events`, {
    token: limitedToken,
  });
  expectArray(limitedEventsBeforeReadAudit.data, "Limited events before ReadAudit");
  assert(
    limitedEventsBeforeReadAudit.data.length === 0,
    "Limited user without ReadAudit should not see namespace events.",
  );
  pass("limited user without ReadAudit receives no namespace events");

  await request(
    "PUT",
    `/api/v1/namespaces/${namespace.data.id}/permissions/group/${limitedGroup.data.id}`,
    {
      ...auth,
      body: ["ReadAudit"],
      expected: [200, 204],
    },
  );
  pass("granted limited group ReadAudit only");

  const limitedGroupPermissions = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/permissions/group/${limitedGroup.data.id}`,
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

  const limitedEventsAfterReadAudit = await request("GET", `/api/v1/namespaces/${namespace.data.id}/events`, {
    token: limitedToken,
  });
  expectArray(limitedEventsAfterReadAudit.data, "Limited events after ReadAudit");
  assert(
    limitedEventsAfterReadAudit.data.length > 0,
    "Limited user with ReadAudit should see namespace events.",
  );
  pass("limited user with ReadAudit can read namespace events");

  const principalPermissions = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/permissions/principal/${limitedUser.data.id}`,
    { ...auth, query: { limit: 25 } },
  );
  expectArray(principalPermissions.data, "Principal namespace permissions");
  pass("listed limited user's effective namespace permissions");

  const readAuditGroups = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/has_permissions/ReadAudit`,
    { ...auth, query: { limit: 25 } },
  );
  expectArray(readAuditGroups.data, "Groups with ReadAudit");
  pass("listed groups with ReadAudit permission");

  const globalEvents = await request("GET", "/api/v1/events", {
    ...auth,
    query: {
      entity_id: namespace.data.id,
      entity_type: "namespace",
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
      entity_type: "namespace",
      limit: 10,
      namespace_id: namespace.data.id,
      sort: "-occurred_at",
    },
  });
  expectArray(filteredEvents.data, "Filtered events");
  assert(filteredEvents.data.length > 0, "Filtered events should include namespace creation.");
  pass("read event feed with action, actor, entity type, and namespace filters");

  const namespaceEvents = await request("GET", `/api/v1/namespaces/${namespace.data.id}/events`, {
    ...auth,
    query: { limit: 25, sort: "-occurred_at" },
  });
  expectArray(namespaceEvents.data, "Namespace events");
  pass("read namespace event feed");

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

  const namespaceHistory = await request("GET", `/api/v1/namespaces/${namespace.data.id}/history`, {
    ...auth,
    query: { limit: 25 },
  });
  expectArray(namespaceHistory.data, "Namespace history");
  assert(hasHeader(namespaceHistory.headers, "x-total-count"), "Namespace history should include X-Total-Count.");
  pass("read namespace history");

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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        actions: ["updated"],
        description: "Delivery lifecycle subscription",
        enabled: true,
        entity_types: ["namespace"],
        filter: {
          actor_kinds: ["user"],
          actor_user_ids: [adminUserId],
          entity_ids: [namespace.data.id],
          namespace_ids: [namespace.data.id],
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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      ...auth,
      body: {
        actions: ["updated"],
        description: "Disabled sink subscription",
        enabled: true,
        entity_types: ["namespace"],
        filter: {
          entity_ids: [namespace.data.id],
          namespace_ids: [namespace.data.id],
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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      expected: 403,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["namespace"],
        name: `limited_denied_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
    },
  );
  pass("limited user without ManageEventSubscription cannot create subscription");

  await request(
    "POST",
    `/api/v1/namespaces/${namespace.data.id}/permissions/group/${limitedGroup.data.id}/ManageEventSubscription`,
    { ...auth, expected: [200, 201, 204] },
  );
  pass("granted limited group ManageEventSubscription");

  limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  const limitedSubscription = await request(
    "POST",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      expected: 201,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["namespace"],
        filter: {
          actor_kinds: ["user"],
          namespace_ids: [namespace.data.id],
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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${limitedSubscription.data.id}`,
    { expected: 204, token: limitedToken },
  );
  pass("limited user with ManageEventSubscription can delete subscription");

  const namespaceUpdatedName = `live_namespace_updated_${suffix}`;
  const classUpdatedName = `live_class_updated_${suffix}`;
  const objectUpdatedName = `live_object_updated_${suffix}`;

  const patchedNamespace = await request("PATCH", `/api/v1/namespaces/${namespace.data.id}`, {
    ...auth,
    body: {
      description: "Updated by frontend live backend contract tests",
      name: namespaceUpdatedName,
    },
    expected: [200, 202],
  });
  assert(patchedNamespace.data.name === namespaceUpdatedName, "Namespace patch should update name.");
  pass("patched namespace for history and delivery checks");

  const firstDelivery = await waitForDelivery(token, deliverySubscription.data.id);
  expectId(firstDelivery, "Generated event delivery");
  pass("created event delivery from namespace update");

  const disabledDeliveries = (await listDeliveries(token)).data.filter(
    (delivery) => delivery.subscription_id === disabledSubscription.data.id,
  );
  assert(disabledDeliveries.length === 0, "Disabled sink subscription should not create deliveries.");
  pass("disabled sink subscription does not fan out deliveries");

  await request("PATCH", `/api/v1/namespaces/${namespace.data.id}`, {
    ...auth,
    body: {
      description: "Updated again by frontend live backend contract tests",
      name: `${namespaceUpdatedName}_again`,
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

  const namespaceHistoryAfterPatch = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/history`,
    { ...auth, query: { limit: 1 } },
  );
  expectArray(namespaceHistoryAfterPatch.data, "Namespace history after patch");
  assert(
    Number(namespaceHistoryAfterPatch.headers.get("x-total-count") ?? "0") >= 2,
    "Namespace history should contain multiple versions after patch.",
  );
  pass("verified namespace history records multiple versions");

  const historyCursor = namespaceHistoryAfterPatch.headers.get("x-next-cursor");
  if (historyCursor) {
    const namespaceHistoryPageTwo = await request(
      "GET",
      `/api/v1/namespaces/${namespace.data.id}/history`,
      { ...auth, query: { cursor: historyCursor, limit: 1 } },
    );
    expectArray(namespaceHistoryPageTwo.data, "Second namespace history page");
  }
  pass("validated namespace history cursor pagination headers");

  const namespaceAsOf = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/history/as-of`,
    { ...auth, query: { at: asOfBeforeUpdates } },
  );
  expectId(namespaceAsOf.data, "Namespace as-of history");
  assert(namespaceAsOf.data.name === namespace.data.name, "Namespace as-of should return original name.");
  pass("read namespace as-of history");

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
    entity_types: ["namespace"],
    filter: {
      actor_kinds: ["user"],
      actor_user_ids: [adminUserId],
      correlation_ids: ["00000000-0000-4000-8000-000000000001"],
      entity_ids: [namespace.data.id],
      entity_names: [namespace.data.name],
      namespace_ids: [namespace.data.id],
      related_namespace_ids: [namespace.data.id],
      request_ids: ["00000000-0000-4000-8000-000000000002"],
    },
    name: `live_subscription_${suffix}`,
    routing: { url: "https://example.test/events" },
    sink_id: sink.data.id,
  };
  const subscription = await request(
    "POST",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      ...auth,
      body: subscriptionPayload,
      expected: 201,
    },
  );
  expectId(subscription.data, "Created event subscription");
  assert(
    subscription.data.filter?.namespace_ids?.includes(namespace.data.id),
    "Created subscription did not preserve namespace filter.",
  );
  assert(
    subscription.data.filter?.actor_user_ids?.includes(adminUserId),
    "Created subscription did not preserve actor user filter.",
  );
  assert(
    subscription.data.filter?.entity_names?.includes(namespace.data.name),
    "Created subscription did not preserve entity name filter.",
  );
  pass("created namespace event subscription with full filter matrix and routing");

  const subscriptions = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    auth,
  );
  expectArray(subscriptions.data, "Event subscriptions");
  assert(
    subscriptions.data.some((item) => item.id === subscription.data.id),
    "Subscription list did not include created subscription.",
  );
  pass("listed namespace event subscriptions");

  const loadedSubscription = await request(
    "GET",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${subscription.data.id}`,
    auth,
  );
  expectId(loadedSubscription.data, "Loaded event subscription");
  pass("loaded namespace event subscription");

  const patchedSubscription = await request(
    "PATCH",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${subscription.data.id}`,
    {
      ...auth,
      body: {
        enabled: false,
        filter: {
          actor_kinds: ["user"],
          entity_ids: [namespace.data.id],
          namespace_ids: [namespace.data.id],
        },
      },
    },
  );
  assert(patchedSubscription.data.enabled === false, "Patched subscription should be disabled.");
  assert(
    patchedSubscription.data.filter?.entity_ids?.includes(namespace.data.id),
    "Patched subscription did not preserve entity id filter.",
  );
  pass("patched namespace event subscription filter");

  await request(
    "DELETE",
    `/api/v1/namespaces/${namespace.data.id}/permissions/group/${limitedGroup.data.id}/ManageEventSubscription`,
    { ...auth, expected: [200, 204] },
  );
  limitedToken = await loginAs(limitedUser.data.name, limitedPassword);
  await request(
    "POST",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
    {
      expected: 403,
      token: limitedToken,
      body: {
        actions: ["created"],
        enabled: true,
        entity_types: ["namespace"],
        name: `limited_denied_again_subscription_${suffix}`,
        routing: { url: "https://example.test/events" },
        sink_id: sink.data.id,
      },
    },
  );
  pass("revoking ManageEventSubscription blocks limited subscription creation again");

  const invalidSubscription = await request(
    "POST",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions`,
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
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${subscription.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("deleted namespace event subscription");

  await request(
    "DELETE",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${deliverySubscription.data.id}`,
    { ...auth, expected: 204 },
  );
  pass("deleted delivery lifecycle subscription");

  await request(
    "DELETE",
    `/api/v1/namespaces/${namespace.data.id}/event-subscriptions/${disabledSubscription.data.id}`,
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
