import type { SessionResponse } from "@/lib/api/generated/models";

export function sessionCredentials(
	overrides: Partial<SessionResponse> = {},
): SessionResponse {
	return {
		session_id: "86f53d97-1135-45c9-a940-f2d36eac2df7",
		token_type: "Bearer",
		access_token: "opaque-backend-token",
		refresh_token: "opaque-refresh-token",
		access_expires_at: new Date(Date.now() + 900_000).toISOString(),
		refresh_expires_at: new Date(Date.now() + 604_800_000).toISOString(),
		absolute_expires_at: new Date(Date.now() + 2_592_000_000).toISOString(),
		...overrides,
	};
}
