import { TasksWorkspace } from "@/components/tasks-workspace";
import { requireServerSession } from "@/lib/auth/guards";

export default async function TasksPage() {
  await requireServerSession();

  return <TasksWorkspace />;
}
