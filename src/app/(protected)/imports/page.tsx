import { ImportsWorkspace } from "@/components/imports-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function ImportsPage() {
  await requireServerSession();

  return <ImportsWorkspace />;
}
