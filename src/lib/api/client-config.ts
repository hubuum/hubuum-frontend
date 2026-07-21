import { getApiV1Config } from "@/lib/api/generated/client";
import type { ClientPaginationConfig } from "@/lib/api/generated/models";

export async function fetchClientPaginationConfig(): Promise<ClientPaginationConfig | null> {
	try {
		const response = await getApiV1Config({ credentials: "include" });
		return response.status === 200 ? response.data.pagination : null;
	} catch {
		return null;
	}
}
