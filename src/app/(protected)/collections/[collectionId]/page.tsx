import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CollectionDetail } from "@/components/collection-detail";
import { hasAdminAccess } from "@/lib/auth/admin";
import { requireServerSession } from "@/lib/auth/guards";
import {
	CORRELATION_ID_HEADER,
	normalizeCorrelationId,
} from "@/lib/correlation";

type CollectionDetailPageProps = {
	params: Promise<{
		collectionId: string;
	}>;
};

function parseId(value: string): number | null {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		return null;
	}

	return parsed;
}

export default async function CollectionDetailPage({
	params,
}: CollectionDetailPageProps) {
	const requestHeaders = await headers();
	const correlationId =
		normalizeCorrelationId(requestHeaders.get(CORRELATION_ID_HEADER)) ??
		undefined;
	const session = await requireServerSession();
	const { collectionId } = await params;
	const parsedCollectionId = parseId(collectionId);

	if (parsedCollectionId === null) {
		notFound();
	}

	const canAdminister = await hasAdminAccess(session.token, correlationId);

	return (
		<section className="stack">
			<CollectionDetail
				canAdminister={canAdminister}
				collectionId={parsedCollectionId}
				currentUsername={session.username ?? null}
			/>
		</section>
	);
}
