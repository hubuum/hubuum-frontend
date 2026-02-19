import "server-only";

import { backendFetchRaw } from "@/lib/api/backend";
import { getGetApiV1IamGroupsUrl } from "@/lib/api/generated/client";

export async function hasAdminAccess(token: string, correlationId?: string): Promise<boolean> {
  try {
    const response = await backendFetchRaw(getGetApiV1IamGroupsUrl(), {
      correlationId,
      method: "GET",
      token
    });

    const allowed = response.status === 200;
    if (!allowed) {
      console.info(`[hubuum-auth][cid=${correlationId ?? "-"}] admin access check denied status=${response.status}`);
    }

    return allowed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[hubuum-auth][cid=${correlationId ?? "-"}] admin access check failed: ${message}`);
    return false;
  }
}
