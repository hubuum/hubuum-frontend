// Test fixture adaptation for both the pinned release and approval-enforcing servers.
export async function credentialRequest(request, password, method, path, options, operation) {
  const expected = options.expected ?? 200;
  const allowed = Array.isArray(expected) ? expected : [expected];
  const initial = await request(method, path, {
    ...options,
    expected: [...allowed, 403],
  });
  if (initial.status !== 403) return initial;
  if (initial.data?.reason !== "reauthentication_required") {
    throw new Error(`${method} ${path} was forbidden without a credential-approval challenge.`);
  }

  const approval = await request("POST", "/api/v1/iam/credential-approvals", {
    token: options.token,
    body: { password, operation },
    expected: 201,
  });
  const isToken = operation.kind === "create_token" || operation.kind === "renew_token";
  if (typeof approval.data?.approval !== "string" ||
      (isToken && typeof approval.data.token_expires_at !== "string")) {
    throw new Error("Credential approval response omitted required fields.");
  }
  return request(method, path, {
    ...options,
    body: isToken
      ? { ...options.body, expires_at: approval.data.token_expires_at }
      : options.body,
    headers: {
      ...options.headers,
      "X-Hubuum-Credential-Approval": approval.data.approval,
    },
  });
}
