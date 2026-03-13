import { TaskDetail } from "@/components/task-detail";
import { requireServerSession } from "@/lib/auth/guards";

type TaskPageProps = {
  params: Promise<{
    taskId: string;
  }>;
};

export default async function TaskPage({ params }: TaskPageProps) {
  await requireServerSession();

  const resolvedParams = await params;
  const taskId = Number.parseInt(resolvedParams.taskId, 10);

  if (!Number.isFinite(taskId) || taskId < 1) {
    return <div className="card error-banner">Task ID must be a positive integer.</div>;
  }

  return <TaskDetail taskId={taskId} />;
}
