import "server-only";

import { backendFetchJson } from "@/lib/api/backend";
import { getGetApiV0MetaCountsUrl, getGetApiV0MetaDbUrl } from "@/lib/api/generated/client";
import type { CountsResponse, DbStateResponse } from "@/lib/api/generated/models";

export type CountsWithOptionalNamespaces = CountsResponse & {
  total_namespaces?: number;
};

export async function fetchMetaCounts(token: string, correlationId?: string): Promise<CountsWithOptionalNamespaces> {
  return backendFetchJson<CountsWithOptionalNamespaces>(getGetApiV0MetaCountsUrl(), {
    correlationId,
    token
  });
}

export async function fetchDbState(token: string, correlationId?: string): Promise<DbStateResponse> {
  return backendFetchJson<DbStateResponse>(getGetApiV0MetaDbUrl(), {
    correlationId,
    token
  });
}

export function getTotalNamespaces(counts: CountsWithOptionalNamespaces): number {
  return typeof counts.total_namespaces === "number" && Number.isFinite(counts.total_namespaces)
    ? counts.total_namespaces
    : 0;
}
