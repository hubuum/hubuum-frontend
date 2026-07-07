import { notFound } from "next/navigation";

import { CollectionDetail } from "@/components/collection-detail";
import { requireServerSession } from "@/lib/auth/guards";

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
	const session = await requireServerSession();
	const { collectionId } = await params;
	const parsedCollectionId = parseId(collectionId);

	if (parsedCollectionId === null) {
		notFound();
	}

	return (
		<section className="stack">
			<CollectionDetail
				collectionId={parsedCollectionId}
				currentUsername={session.username ?? null}
			/>
		</section>
	);
}
