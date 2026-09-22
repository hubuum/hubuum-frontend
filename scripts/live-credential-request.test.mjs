import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { credentialRequest } from "./live-credential-request.mjs";

function fixture(responses) {
  const calls = [];
  return {
    calls,
    request: async (...args) => {
      calls.push(args);
      const response = responses.shift();
      if (response instanceof Error) throw response;
      assert.ok(response, "unexpected additional request");
      return response;
    },
  };
}

const path = "/api/v1/iam/principals/2/tokens";
const options = { token: randomBytes(32).toString("hex"), body: { name: "fixture" }, expected: 201,
  headers: { "If-Match": '"revision-2"', "Idempotency-Key": "fixture-key" } };
const operation = { kind: "create_token", principal_id: 2, token: options.body };
const password = randomBytes(32).toString("hex");
const challenge = { status: 403, data: { reason: "reauthentication_required" } };

test("older servers need neither approval nor an additional request", async () => {
  const result = { status: 201, data: {} };
  const f = fixture([result]);
  assert.equal(await credentialRequest(f.request, password, "POST", path, options, operation), result);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0][2].body, options.body);
});

test("approval preserves the bearer, guards, request, and precise resolved expiry", async () => {
  const approval = randomBytes(32).toString("hex");
  const expiry = "2026-09-23T12:00:00.123456";
  const f = fixture([challenge, { status: 201, data: { approval, token_expires_at: expiry } }, { status: 201 }]);
  await credentialRequest(f.request, password, "POST", path, options, operation);
  assert.deepEqual(f.calls[1], ["POST", "/api/v1/iam/credential-approvals", {
    token: options.token, body: { password, operation }, expected: 201,
  }]);
  assert.deepEqual(f.calls[2], ["POST", path, {
    ...options, body: { ...options.body, expires_at: expiry },
    headers: { ...options.headers, "X-Hubuum-Credential-Approval": approval },
  }]);
});

for (const kind of ["create_user", "confirm_restore"]) {
  test(`${kind} preserves its exact body`, async () => {
    const f = fixture([challenge, { status: 201, data: { approval: randomBytes(32).toString("hex") } }, { status: 201 }]);
    await credentialRequest(f.request, password, "POST", path, options, { kind });
    assert.deepEqual(f.calls[2][2].body, options.body);
  });
}

test("ordinary forbidden responses do not request approval", async () => {
  const f = fixture([{ status: 403, data: { reason: "permission_denied" } }]);
  await assert.rejects(credentialRequest(f.request, password, "POST", path, options, operation), /without a credential-approval challenge/);
  assert.equal(f.calls.length, 1);
});

test("failed approval never falls back to an unapproved mutation", async () => {
  const f = fixture([challenge, new Error("password rejected")]);
  await assert.rejects(credentialRequest(f.request, password, "POST", path, options, operation), /password rejected/);
  assert.equal(f.calls.length, 2);
});

test("a lost mutation response is not retried", async () => {
  const f = fixture([new Error("connection lost")]);
  await assert.rejects(credentialRequest(f.request, password, "POST", path, options, operation), /connection lost/);
  assert.equal(f.calls.length, 1);
});
