import { SearchWorkspace } from "@/components/search-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function SearchPage() {
  await requireServerSession();

  return <SearchWorkspace />;
}
