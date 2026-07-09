import { CollectionsTable } from "@/components/collections-table";
import { requireServerSession } from "@/lib/auth/guards";

export default async function CollectionsPage() {
	await requireServerSession();

	return <CollectionsTable />;
}
