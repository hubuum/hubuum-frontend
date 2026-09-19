/** The backend validates the typed payload; keep every supplied field intact. */
export type CredentialPayload = Record<string, unknown>;

export type CredentialOperation =
	| { kind: "create_token"; principal_id: number; token: CredentialPayload }
	| {
			kind: "renew_token";
			principal_id: number;
			token_id: number;
			token: CredentialPayload;
	  }
	| { kind: "create_user"; user: CredentialPayload }
	| { kind: "update_user"; user_id: number; user: CredentialPayload }
	| { kind: "import_credentials"; import: CredentialPayload }
	| {
			kind: "confirm_restore";
			restore_id: number;
			confirmation: CredentialPayload;
	  };

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

const TOKEN_PATH =
	/^\/api\/v1\/iam\/principals\/([1-9]\d*)\/tokens(?:\/([1-9]\d*)\/renew)?\/?$/;
const USERS_PATH = /^\/api\/v1\/iam\/users\/?$/;
const USER_PATH = /^\/api\/v1\/iam\/users\/([1-9]\d*)\/?$/;
const IMPORT_PATH = /^\/api\/v1\/imports\/?$/;
const RESTORE_PATH = /^\/api\/v1\/restores\/([1-9]\d*)\/confirm\/?$/;

export function isCredentialMutationPath(
	method: string,
	path: string,
): boolean {
	return method === "POST"
		? [TOKEN_PATH, USERS_PATH, IMPORT_PATH, RESTORE_PATH].some((pattern) =>
				pattern.test(path),
			)
		: method === "PATCH" && USER_PATH.test(path);
}

/** Exact paths only: this is also the allowlist for the reauthentication BFF. */
export function credentialOperation(
	method: string,
	path: string,
	body: unknown,
): CredentialOperation | null {
	if (!isRecord(body)) return null;
	const token = TOKEN_PATH.exec(path);
	if (method === "POST" && token) {
		const principal_id = Number(token[1]);
		const token_id = token[2] ? Number(token[2]) : null;
		if (
			!Number.isSafeInteger(principal_id) ||
			(token_id !== null && !Number.isSafeInteger(token_id))
		)
			return null;
		return token_id === null
			? { kind: "create_token", principal_id, token: body }
			: { kind: "renew_token", principal_id, token_id, token: body };
	}
	if (method === "POST" && USERS_PATH.test(path)) {
		return { kind: "create_user", user: body };
	}
	const user = USER_PATH.exec(path);
	if (
		method === "PATCH" &&
		user &&
		typeof body.password === "string" &&
		Number.isSafeInteger(Number(user[1]))
	) {
		return { kind: "update_user", user_id: Number(user[1]), user: body };
	}
	if (method === "POST" && IMPORT_PATH.test(path)) {
		return { kind: "import_credentials", import: body };
	}
	const restore = RESTORE_PATH.exec(path);
	if (
		method === "POST" &&
		restore &&
		Number.isSafeInteger(Number(restore[1]))
	) {
		return {
			kind: "confirm_restore",
			restore_id: Number(restore[1]),
			confirmation: body,
		};
	}
	return null;
}

export function credentialOperationSummary(
	operation: CredentialOperation,
): string {
	switch (operation.kind) {
		case "create_token":
		case "renew_token": {
			const action =
				operation.kind === "create_token"
					? "Create token"
					: `Renew token #${operation.token_id}`;
			const scope =
				operation.kind === "renew_token"
					? "Preserve the existing token scope"
					: operation.token.scope == null
						? "All permissions and resources allowed for this principal"
						: JSON.stringify(operation.token.scope, null, 2);
			return `${action} for principal #${operation.principal_id}.\nName: ${String(operation.token.name ?? "Unnamed")}\nExpiry: ${String(operation.token.expires_at ?? "Server default lifetime")}\nScope: ${scope}`;
		}
		case "create_user":
			return `Create user ${String(operation.user.name ?? "")} (${String(operation.user.identity_scope ?? "local")}).`;
		case "update_user":
			return `Update the password and submitted profile fields for user #${operation.user_id}.`;
		case "import_credentials": {
			const principals =
				isRecord(operation.import.graph) &&
				Array.isArray(operation.import.graph.principals)
					? operation.import.graph.principals
							.filter(isRecord)
							.map((principal) => String(principal.name ?? "Unnamed"))
					: [];
			return `${operation.import.dry_run ? "Validate" : "Submit"} the prepared import, including account credentials.\nPrincipals: ${principals.join(", ") || "See prepared import"}`;
		}
		case "confirm_restore":
			return `Replace all Hubuum data with restore #${operation.restore_id}.\nSHA-256: ${String(operation.confirmation.sha256 ?? "")}`;
	}
}
