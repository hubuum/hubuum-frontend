"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";

import { ClientCorrelation } from "@/components/client-correlation";
import { CredentialConfirmationDialog } from "@/components/credential-confirmation";
import { makeQueryClient } from "@/lib/query-client";

type QueryProviderProps = {
	children: ReactNode;
};

export function QueryProvider({ children }: QueryProviderProps) {
	const [queryClient] = useState(() => makeQueryClient());

	return (
		<QueryClientProvider client={queryClient}>
			<ClientCorrelation />
			{children}
			<CredentialConfirmationDialog />
		</QueryClientProvider>
	);
}
