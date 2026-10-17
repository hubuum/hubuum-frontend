import { AdvancedSearchWorkspace } from "@/components/advanced-search-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function AdvancedSearchPage({
	searchParams,
}: {
	searchParams: Promise<{ query?: string }>;
}) {
	await requireServerSession();
	const { query } = await searchParams;
	return <AdvancedSearchWorkspace key={query ?? "new"} savedQuery={query} />;
}
